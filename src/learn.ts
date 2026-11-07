// Learning loop: when the gate is overruled (a human override, a post-merge
// revert, or a labeled bench case), distill the miss into a general rule and
// add it to the playbook. Rules that keep misfiring get retired.
import { randomUUID } from "node:crypto";
import { PullRequest } from "./evidence.ts";
import { Gateway, parseJSON } from "./gateway.ts";
import { Verdict } from "./judge.ts";
import { Lesson, Store } from "./memory.ts";

export interface Feedback {
  expected: "approve" | "block";
  note?: string; // what the reviewer / incident revealed
}

export async function learnFromMiss(gw: Gateway, store: Store, pr: PullRequest, v: Verdict, fb: Feedback): Promise<Lesson | null> {
  const existing = (await store.lessons()).filter((l) => !l.retired);
  const prompt = `A merge gate reviewing AI-agent pull requests made a wrong call.
Gate said: ${v.verdict.toUpperCase()} (confidence ${v.confidence})
Gate's findings: ${v.findings.join(" | ") || "none"}
Correct call: ${fb.expected.toUpperCase()}
Reviewer note: ${fb.note ?? "none"}

PR title: ${pr.title}
PR description: ${pr.description}
Diff:
\`\`\`diff
${pr.patch.slice(0, 8000)}
\`\`\`

Existing playbook:
${existing.map((l) => `- [${l.id}] WHEN ${l.trigger} THEN ${l.rule}`).join("\n") || "(empty)"}

Write ONE new review rule that would have produced the correct call, and that generalises to other repositories.
It must not mention this repo's file names, function names or literal values. Describe the pattern, and how to check for it (e.g. what to probe).
If an existing rule already covers it but was ignored, restate it sharper.
Respond with JSON only: {"trigger": "...", "rule": "..."}`;
  try {
    // No response_format: not every provider honours it; we parse JSON out of the text instead.
    const r = await gw.chat([{ role: "user", content: prompt }], { maxTokens: 1500, reasoningEffort: "low" });
    const j = parseJSON<{ trigger: string; rule: string }>(r.content);
    if (!j.rule || !j.trigger) return null;
    const lesson: Lesson = {
      id: `L${randomUUID().slice(0, 6)}`,
      rule: j.rule.trim(),
      trigger: j.trigger.trim(),
      source: pr.id,
      createdAt: new Date().toISOString(),
      hits: 0,
      misses: 0,
    };
    await store.saveLesson(lesson);
    return lesson;
  } catch (e: any) {
    console.error(`  ! learn failed on ${pr.id}: ${String(e?.message ?? e).slice(0, 300)}`);
    return null;
  }
}

export async function creditLessons(store: Store, v: Verdict, correct: boolean): Promise<void> {
  const all = await store.lessons();
  for (const id of v.lessonsCited) {
    const l = all.find((x) => x.id === id);
    if (!l) continue;
    const hits = l.hits + (correct ? 1 : 0);
    const misses = l.misses + (correct ? 0 : 1);
    await store.updateLesson(id, { hits, misses, retired: misses >= 2 && misses > hits });
  }
}

export async function activeLessons(store: Store, limit = 15): Promise<Lesson[]> {
  return (await store.lessons())
    .filter((l) => !l.retired)
    .sort((a, b) => b.hits - b.misses - (a.hits - a.misses))
    .slice(0, limit);
}
