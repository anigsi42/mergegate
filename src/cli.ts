#!/usr/bin/env -S npx tsx
// mergegate CLI
//   review --base <repo dir> --patch <file> [--title t] [--desc d]   → exit 1 on block
//   bench  [--iterations 3] [--reset] [--heuristic]                  → learning-loop benchmark
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { FIXTURE, cases, toPR } from "../bench/build.ts";
import { Case } from "../bench/cases.ts";
import { PullRequest, gatherEvidence } from "./evidence.ts";
import { Gateway } from "./gateway.ts";
import { Verdict, judgeHeuristic, judgeWithModel } from "./judge.ts";
import { triage } from "./triage.ts";
import { activeLessons, creditLessons, learnFromMiss } from "./learn.ts";
import { Lesson, RunRecord, Store, openStore } from "./memory.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string" },
    patch: { type: "string" },
    title: { type: "string", default: "Untitled PR" },
    desc: { type: "string", default: "" },
    iterations: { type: "string", default: "3" },
    reset: { type: "boolean", default: false },
    heuristic: { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
    samples: { type: "string", default: "1" },
    out: { type: "string", default: ".mergegate/results.json" },
  },
});

async function review(gw: Gateway | null, store: Store, pr: PullRequest, base: string, lessons: Lesson[]) {
  const t0 = Date.now();
  const ev = gatherEvidence(base, pr);
  const tokBefore = gw ? gw.usage.prompt_tokens + gw.usage.completion_tokens : 0;
  let v: Verdict;
  try {
    const t = gw ? await triage(pr, ev) : undefined;
    if (t?.error) console.error(`  ! triage: ${t.error}`);
    v = gw ? await judgeWithModel(gw, pr, ev, lessons, t) : judgeHeuristic(ev);
    v.triage = t;
  } catch (e) {
    console.error(`  ! ${pr.id}: model judge failed (${(e as Error).message.slice(0, 120)}); falling back to heuristic`);
    v = judgeHeuristic(ev);
  }
  const tokens = gw ? gw.usage.prompt_tokens + gw.usage.completion_tokens - tokBefore : 0;
  return { v, ev, ms: Date.now() - t0, tokens };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function preflight(gw: Gateway) {
  try {
    await gw.chat([{ role: "user", content: "Reply with: ok" }], { maxTokens: 16 });
    console.log(`model: ${gw.provider.name}/${gw.provider.model} ✓`);
  } catch (e: any) {
    console.error(`model: ${gw.provider.name} rejected the key in ${gw.provider.apiKeyEnv} — ${String(e.message).slice(0, 160)}`);
    console.error(`fix the key, or run the offline baseline with --heuristic`);
    process.exit(2);
  }
  if (process.env.SUBQ_API_KEY && !/^sk-/.test(process.env.SUBQ_API_KEY)) console.error("triage: SUBQ_API_KEY doesn't look like a Subquadratic key (expected sk-...)");
}

async function cmdReview() {
  if (!values.base || !values.patch) throw new Error("review needs --base and --patch");
  const store = await openStore();
  const gw = !values.heuristic && Gateway.available() ? new Gateway() : null;
  if (gw) await preflight(gw);
  const pr: PullRequest = { id: `pr-${randomUUID().slice(0, 6)}`, title: values.title!, description: values.desc!, patch: readFileSync(values.patch, "utf8") };
  const lessons = await activeLessons(store);
  const { v, ev, ms, tokens } = await review(gw, store, pr, values.base, lessons);
  await store.saveRun({ runId: "review", iteration: 0, prId: pr.id, verdict: v.verdict, confidence: v.confidence, findings: v.findings, lessonsUsed: v.lessonsCited, mode: v.mode, provider: gw?.provider.name, tokens, ms, at: new Date().toISOString() });
  const md = renderComment(pr, v, ev.before.total, ev.after);
  console.log(md);
  writeFileSync(".mergegate/last-review.md", md);
  await store.close();
  process.exit(v.verdict === "block" ? 1 : 0);
}

export function renderComment(pr: PullRequest, v: Verdict, before: number, after: { pass: number; fail: number; total: number }) {
  const icon = v.verdict === "approve" ? "✅ APPROVE" : "⛔ BLOCK";
  return `### mergegate: ${icon}  (confidence ${(v.confidence * 100).toFixed(0)}%)
Tests: ${after.pass}/${after.total} passing after change (was ${before} tests). Judge: ${v.mode}.

${v.findings.map((f) => `- ${f}`).join("\n")}
${v.steps.length ? `\n<details><summary>Investigation (${v.steps.length} steps)</summary>\n\n${v.steps.map((s) => `- \`${s}\``).join("\n")}\n</details>` : ""}${v.lessonsCited.length ? `\nPlaybook rules applied: ${v.lessonsCited.join(", ")}` : ""}`;
}

interface IterationResult {
  iteration: number;
  split: "train" | "holdout";
  accuracy: number;
  correct: number;
  total: number;
  lessons: number;
  tokens: number;
  samples: number;
  unstable: number; // cases whose samples disagreed
  sampleAccuracy: number; // fraction of individual reviews that were right
  cases: { id: string; family: string; expected: string; verdict: string; votes: string[]; stable: boolean; correct: boolean; confidence: number; findings: string[]; lessonsCited: string[]; steps: string[] }[];
}

async function cmdBench() {
  const store = await openStore();
  if (values.reset) await store.reset();
  const useModel = !values.heuristic && Gateway.available();
  if (!values.heuristic && !useModel) console.error("No model key set (MODEL_API_KEY) — running the heuristic baseline only. Learning needs a model.");
  const gw = useModel ? new Gateway() : null;
  if (gw) await preflight(gw);
  const iterations = useModel ? Number(values.iterations) : 0;
  const runId = `bench-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const conc = Number(values.concurrency);
  const prs = new Map<string, PullRequest>(cases().map((c) => [c.id, toPR(c)]));
  const results: IterationResult[] = [];
  const learned: Lesson[] = [];

  const evaluate = async (split: "train" | "holdout", iteration: number) => {
    const lessons = await activeLessons(store);
    const tok0 = gw ? gw.usage.prompt_tokens + gw.usage.completion_tokens : 0;
    const set = cases(split);
    const n = Math.max(1, Number(values.samples));
    const jobs = set.flatMap((c) => Array.from({ length: n }, (_, k) => ({ c, k })));
    const raw = await pool(jobs, conc, async ({ c, k }) => {
      const r = await review(gw, store, prs.get(c.id)!, FIXTURE, lessons);
      const correct = r.v.verdict === c.label;
      const rec: RunRecord = { runId, iteration, prId: `${c.id}#${k}`, verdict: r.v.verdict, expected: c.label, correct, confidence: r.v.confidence, findings: r.v.findings, lessonsUsed: r.v.lessonsCited, mode: r.v.mode, provider: gw?.provider.name, tokens: r.tokens, ms: r.ms, at: new Date().toISOString() };
      await store.saveRun(rec);
      return { c, v: r.v, correct };
    });
    // Majority verdict per case; ties count as block (a gate should fail closed).
    const rs = set.map((c) => {
      const mine = raw.filter((r) => r.c.id === c.id);
      const blocks = mine.filter((r) => r.v.verdict === "block").length;
      const verdict: "approve" | "block" = blocks * 2 >= mine.length ? "block" : "approve";
      const wrongSample = mine.find((r) => !r.correct);
      const rep = mine.find((r) => r.v.verdict === verdict)!;
      return { c, v: rep.v, verdict, correct: verdict === c.label, stable: blocks === 0 || blocks === mine.length, votes: mine.map((r) => r.v.verdict), wrongSample };
    });
    const res: IterationResult = {
      iteration,
      split,
      correct: rs.filter((r) => r.correct).length,
      total: rs.length,
      accuracy: rs.filter((r) => r.correct).length / rs.length,
      lessons: lessons.length,
      tokens: gw ? gw.usage.prompt_tokens + gw.usage.completion_tokens - tok0 : 0,
      samples: n,
      unstable: rs.filter((r) => !r.stable).length,
      sampleAccuracy: raw.filter((r) => r.correct).length / raw.length,
      cases: rs.map((r) => ({ id: r.c.id, family: r.c.family, expected: r.c.label, verdict: r.verdict, votes: r.votes, stable: r.stable, correct: r.correct, confidence: r.v.confidence, findings: r.v.findings, lessonsCited: r.v.lessonsCited, steps: r.v.steps })),
    };
    results.push(res);
    console.log(`iter ${iteration} ${split.padEnd(7)} ${res.correct}/${res.total} (${(res.accuracy * 100).toFixed(0)}%)  per-review ${(res.sampleAccuracy * 100).toFixed(0)}%  unstable=${res.unstable}  playbook=${lessons.length}  tokens=${res.tokens}  misses: ${rs.filter((r) => !r.correct).map((r) => r.c.id).join(", ") || "none"}`);
    return rs;
  };

  // Heuristic floor, for reference.
  if (gw) {
    let ok = 0;
    for (const c of cases("holdout")) if (judgeHeuristic(gatherEvidence(FIXTURE, prs.get(c.id)!)).verdict === c.label) ok++;
    console.log(`heuristic floor (holdout): ${ok}/${cases("holdout").length}`);
  }

  for (let it = 0; it <= iterations; it++) {
    await evaluate("holdout", it); // scored, never learned from
    if (!gw || it === iterations) break;
    const train = await evaluate("train", it);
    for (const r of train) {
      await creditLessons(store, r.v, r.correct);
      // Learn from any wrong review — a majority miss, or a flip on an unstable case.
      const miss = !r.correct ? r.v : r.wrongSample?.v;
      if (miss) {
        const l = await learnFromMiss(gw, store, prs.get(r.c.id)!, miss, { expected: r.c.label, note: r.c.note });
        if (l) { learned.push(l); console.log(`  + learned ${l.id} from ${r.c.id}: WHEN ${l.trigger} THEN ${l.rule}`); }
      }
    }
  }

  mkdirSync(".mergegate", { recursive: true });
  const out = {
    runId,
    provider: gw ? `${gw.provider.name}/${gw.provider.model}` : "heuristic",
    store: store.kind,
    at: new Date().toISOString(),
    totalTokens: gw ? gw.usage.prompt_tokens + gw.usage.completion_tokens : 0,
    modelCalls: gw?.calls ?? 0,
    iterations: results,
    playbook: await store.lessons(),
    learnedThisRun: learned.map((l) => l.id),
  };
  writeFileSync(values.out!, JSON.stringify(out, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, benchSummary(out), { flag: "a" });
  console.log(`\nwrote ${values.out}  (${out.modelCalls} model calls, ${out.totalTokens} tokens, store=${store.kind})`);
  await store.close();
}

function benchSummary(out: any): string {
  const hold = out.iterations.filter((r: IterationResult) => r.split === "holdout");
  const rows = hold.map((r: IterationResult) => `| ${r.iteration} | ${r.correct}/${r.total} (${(r.accuracy * 100).toFixed(0)}%) | ${(r.sampleAccuracy * 100).toFixed(0)}% | ${r.unstable} | ${r.lessons} | ${r.tokens} | ${r.cases.filter((c) => !c.correct).map((c) => c.id).join(", ") || "—"} |`).join("\n");
  const rules = out.playbook.filter((l: Lesson) => !l.retired).map((l: Lesson) => `- **${l.id}** (from ${l.source}, ${l.hits}✓/${l.misses}✗): WHEN ${l.trigger} THEN ${l.rule}`).join("\n");
  return `## mergegate learning-loop benchmark
Judge: \`${out.provider}\` · memory: ${out.store} · ${out.modelCalls} model calls · ${out.totalTokens} tokens

Held-out PRs (never learned from) — accuracy per iteration:

| Iteration | Held-out accuracy (majority) | Per-review accuracy | Unstable PRs | Playbook rules | Tokens | Misses |
|---|---|---|---|---|---|---|
${rows}

### Playbook learned this run
${rules || "_none_"}
`;
}

const cmd = positionals[0];
(cmd === "review" ? cmdReview() : cmd === "bench" ? cmdBench() : Promise.reject(new Error("usage: mergegate review|bench"))).catch((e) => {
  console.error(e.message);
  process.exit(2);
});
