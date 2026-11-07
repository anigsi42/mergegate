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

async function cmdReview() {
  if (!values.base || !values.patch) throw new Error("review needs --base and --patch");
  const store = await openStore();
  const gw = !values.heuristic && Gateway.available() ? new Gateway() : null;
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
  cases: { id: string; family: string; expected: string; verdict: string; correct: boolean; confidence: number; findings: string[]; lessonsCited: string[]; steps: string[] }[];
}

async function cmdBench() {
  const store = await openStore();
  if (values.reset) await store.reset();
  const useModel = !values.heuristic && Gateway.available();
  if (!values.heuristic && !useModel) console.error("No model key set (MODEL_API_KEY) — running the heuristic baseline only. Learning needs a model.");
  const gw = useModel ? new Gateway() : null;
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
    const rs = await pool(set, conc, async (c: Case) => {
      const r = await review(gw, store, prs.get(c.id)!, FIXTURE, lessons);
      const correct = r.v.verdict === c.label;
      const rec: RunRecord = { runId, iteration, prId: c.id, verdict: r.v.verdict, expected: c.label, correct, confidence: r.v.confidence, findings: r.v.findings, lessonsUsed: r.v.lessonsCited, mode: r.v.mode, provider: gw?.provider.name, tokens: r.tokens, ms: r.ms, at: new Date().toISOString() };
      await store.saveRun(rec);
      return { c, v: r.v, correct };
    });
    const res: IterationResult = {
      iteration,
      split,
      correct: rs.filter((r) => r.correct).length,
      total: rs.length,
      accuracy: rs.filter((r) => r.correct).length / rs.length,
      lessons: lessons.length,
      tokens: gw ? gw.usage.prompt_tokens + gw.usage.completion_tokens - tok0 : 0,
      cases: rs.map((r) => ({ id: r.c.id, family: r.c.family, expected: r.c.label, verdict: r.v.verdict, correct: r.correct, confidence: r.v.confidence, findings: r.v.findings, lessonsCited: r.v.lessonsCited, steps: r.v.steps })),
    };
    results.push(res);
    console.log(`iter ${iteration} ${split.padEnd(7)} ${res.correct}/${res.total} (${(res.accuracy * 100).toFixed(0)}%)  playbook=${lessons.length}  tokens=${res.tokens}  misses: ${rs.filter((r) => !r.correct).map((r) => r.c.id).join(", ") || "none"}`);
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
      if (!r.correct) {
        const l = await learnFromMiss(gw, store, prs.get(r.c.id)!, r.v, { expected: r.c.label, note: r.c.note });
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
  console.log(`\nwrote ${values.out}  (${out.modelCalls} model calls, ${out.totalTokens} tokens, store=${store.kind})`);
  await store.close();
}

const cmd = positionals[0];
(cmd === "review" ? cmdReview() : cmd === "bench" ? cmdBench() : Promise.reject(new Error("usage: mergegate review|bench"))).catch((e) => {
  console.error(e.message);
  process.exit(2);
});
