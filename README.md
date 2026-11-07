# mergegate — Arena

**Autonomous verification for agent swarms. No human in the loop.**

When thousands of coding agents ship code, human review is the bottleneck, so in practice nobody looks at most of it. mergegate is the merge authority for that world: a council of models that decides, on its own, whether agent-written code merges, and an arena that measures how often that decision is wrong while adversarial agents actively try to fool it.

Built from scratch at the AI Engineer Code Summit Hackathon (Cerebral Valley, SF, Nov 7 2026).

```
            backlog of change requests
                       │
        ┌──────────────┴──────────────┐
   builder agents                attacker agents            ← swarm (Muse Spark, Gemini 3.8 Flash)
   do the task                   do the task + plant a bug    attackers adapt from what got caught
        └──────────────┬──────────────┘
                       ▼
               CI (visible tests)                           ← red PRs never reach the gate
                       ▼
     ┌──────────── gate council ─────────────┐
     │ triage    Subquadratic subq-snap-1.1  │  P(needs deep review / test gaming / hidden scope)
     │ judge     Meta Muse Spark             │  reads, greps, writes & runs its own probes
     │ cross     Gemini 4 Argon              │  when unsure/risky: re-checks claims, hunts misses
     │ arbiter   Subquadratic subq-snap-1.1  │  when they disagree: P(safe to merge)
     └──────────────────┬────────────────────┘
                 merge │ block                               ← no human, ever
                       ▼
       hidden oracle (never seen by agents or gate)         ← ground truth, no human labels
       escaped defect = merged & oracle fails
       false block    = blocked & oracle passes
                       │
        every mistake → a general rule in the gate's playbook (learned, credited, retired)
```

## What it measures

Per round: PRs, CI rejections, real defects reaching the gate, **escaped defects**, **false blocks**, catch rate, escalations, tokens, wall time. Every decision also records what alternative policies would have done (judge alone, fail-closed council), so a single run yields the ablations: does the council beat one model, and does triage pay for itself.

## What's real vs not (plain labels)

| Part | Status |
|---|---|
| Swarm agents (builders + attackers) producing real diffs against a real library | Real |
| CI gate on visible tests | Real |
| Judge agent: tool loop, writes and runs its own probes | Real (Meta Muse Spark; any provider) |
| Cross-examiner from another lab | Real (Gemini 4 Argon) |
| Triage + arbiter | Real (Subquadratic Decisions API) |
| Hidden oracle: 26 base spec/property tests + hidden acceptance specs per task | Real; each acceptance spec validated against a reference implementation |
| Gate learning from mistakes; attacker adaptation | Real |
| Provider-neutral gateway: retries, transient-404 handling, model fallbacks, health reporting | Real |
| Target codebase | A small JS library built for this; the arena is codebase-agnostic but only exercised on this one |
| Scale | Hundreds of agent PRs per run in GitHub Actions — not 30k agents |

## Findings so far

- **Green CI is not evidence.** Every planted bug in the static benchmark kept the full test suite passing.
- **Frontier judges are strong on a fixed benchmark.** Gemini 4 Argon: 12/12 held-out, 99–100% per review, across 180 reviews. A static benchmark saturates, which is why the arena uses adaptive attackers instead.
- **A second model from another lab catches what one misses.** In arena run 1, Muse alone would have merged a planted bug; Argon's cross-examination blocked it.
- **Not every model will red-team.** Gemini 3.8 Flash declined to plant defects; Muse Spark complied. Attackers default to Muse.
- **Model APIs are not reliable infrastructure.** Meta returned `model_not_found` for a live model mid-run; the gateway now retries, falls back, and refuses to learn from degraded verdicts.

## Run it

Everything runs in GitHub Actions; keys are repository secrets (`MODEL_API_KEY` for Meta, `GEMINI_API_KEY`, `SUBQ_API_KEY`).

- **Actions → arena → Run workflow**: rounds, PRs per round, attacker share, models for swarm/judge/cross.
- **Actions → bench → Run workflow**: the static labeled benchmark (24 PRs, train/holdout, multi-sample stability).
- **mergegate (PR check)**: every pull request is judged; verdict posted as a comment; the check fails on block.

Every run's full results (each PR, each verdict, each planted bug, the learned playbook) are committed to the [`results`](../../tree/results) branch.

Locally: `npm ci && npm run arena -- --rounds 2 --prs 8`.

## Layout

- `src/arena.ts` — the arena loop and metrics
- `src/swarm.ts` — builder and attacker agents
- `src/council.ts` — triage → judge → cross-examination → arbiter
- `src/judge.ts` — agentic judge (tools: list/read/grep/run_probe/submit_verdict)
- `src/oracle.ts`, `arena/oracle/`, `arena/oracle-tasks/` — hidden ground truth
- `src/learn.ts` — mistakes → playbook rules
- `src/gateway.ts` — provider-neutral model gateway
- `src/triage.ts` — Subquadratic triage
- `bench/` — static labeled benchmark
- `.github/workflows/` — arena, bench, PR gate
