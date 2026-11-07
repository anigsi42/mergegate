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
        every mistake → playbook memory (layer 1 of the learning stack below)
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

## Results — Arena run (Nov 7, [run 42424273041](../../actions/runs/42424273041))

Builders: Muse Spark 1.3 + Gemini 3.8 Flash · Attackers: Muse Spark 1.3 (50%) · Judge: Muse Spark 1.3 · Cross-examiner: Gemini 4 Argon · Triage + arbiter: Subquadratic · no human in the loop

| Round | PRs | Reached gate | Real defects (oracle) | Escaped | False blocks | Escalated to Argon | Gate rules in force |
|---|---|---|---|---|---|---|---|
| 1 | 16 | 16 | 4 | 1 | 4 | 7 | 0 |
| 2 | 16 | 15 | 5 | **0** | **1** | 5 | 4 |
| 3 | 16 | 16 | 4 | **4** | 0 | 6 | 4 |
| 4 | 16 | 15 | 4 | 2 | 2 | 6 | 4 |
| **Total** | **64** | **62** | **17** | **7** | **7** | **24** | |

~1.65M tokens, ~23 minutes wall time, every PR/verdict/planted bug in the [`results`](../../tree/results) branch.

What it shows — including what didn't work:

- **Learning changes behaviour, measurably, in both directions.** After round 1 the gate wrote 4 rules from the oracle's incident reports (3 from false blocks, 1 from an escape). Round 2: escapes 1 → 0, false blocks 4 → 1. Round 3: the rules learned from false blocks ("don't block on unpromised variants") over-corrected — the gate merged all 16 PRs and 4 planted bugs escaped. It then learned a counter-rule; round 4 partially recovered. This is the core open problem of self-improving verifiers: leniency learned from false alarms is exactly what an adaptive attacker exploits. The playbook needs outcome-weighted retirement of rules, not just accumulation — next step.
- **The council trades false blocks for catches.** Judge alone would have let 9 defects through with 3 false blocks; the council let 7 through with 7 false blocks.
- **Attackers are good.** Muse planted 17 oracle-detectable bugs with CI green on every one: first-only comma replacement, `|0` overflow, `isSafeInteger` swaps, silent type coercion, off-by-one on window boundaries, `||` vs `??` defaults.
- **Infrastructure is the bottleneck, not intelligence.** 9 judge calls fell back to heuristics because an empty assistant turn from the provider was echoed back and rejected (fixed after the run); Meta also returned transient `model_not_found` for live models (gateway now rides these out).

### Static benchmark (24 labeled PRs, held-out split)

- **Green CI is not evidence.** Every planted bug kept the full suite passing; a rule-based checker gets 6/12 held-out.
- **Gemini 4 Argon: 12/12 held-out, 99–100% per review over 180 reviews.** A static benchmark saturates — why the arena uses adaptive attackers.
- **Not every model will red-team.** Gemini 3.8 Flash declined to plant defects; Muse Spark complied.

## Why this matters past today: verification is the bottleneck for superhuman coding

As models get better at writing code, the hard problem moves to *checking* it: scalable oversight. You cannot hand-label millions of agent PRs, and agents optimise against whatever check you give them (round 3 is a live example of that Goodhart effect). The arena is built around that:

- **Verifiable reward without humans.** The hidden oracle turns every agent PR into a labelled example with a ground-truth reward. The arena is a data engine, not just a test.
- **Adversarial co-evolution.** Attackers adapt to the verifier, so the evaluation gets harder as the verifier gets better, instead of saturating like our static benchmark did.
- **Cross-lab oversight.** Models from different labs check each other; disagreement is a signal, resolved by a separate decision model.

### The learning stack (layer 1 is what ran today)

1. **Playbook memory** *(built)* — the judge distils each mistake into guidance it reads on future reviews. Weakness shown in round 3: lessons are unconditional and unweighted, so leniency learned from false alarms becomes an exploit.
2. **Precedent memory** — retrieve the most similar past PRs and their real outcomes; reason from evidence, not abstractions.
3. **Executable probe library** — every probe that caught a real bug is kept as code and run on future PRs. Verification knowledge that executes and compounds.
4. **Goal- and cost-aware decision policy** — merge/escalate/block thresholds learned from outcomes, weighted by the cost of error in that domain (an escaped defect in a trading system is not a typo in docs).
5. **Long-context reasoning over whole systems** — reviewing a change against the full codebase, its history and its incident record, not a diff in isolation.
6. **Training the verifier itself** — fine-tune open-weight judges on oracle-scored review trajectories (reinforcement learning from verifiable reward), with the arena generating the data.

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
