# mergegate

A merge gate for code written by coding agents. It applies an agent's PR in isolation, runs the suite before and after, investigates the patched code with tools (reads files, greps, **writes and runs its own probes to try to break the change**), and approves or blocks. When it is overruled, it distills the miss into a general rule and gets measurably better on PRs it has never seen.

Built for the AI Engineer Code Summit Hackathon (Nov 7, 2026) — themes: *systems that get measurably better with every run* and *verify what other agents ship before it merges*.

## Why

Agents optimise for "tests pass". In the bundled benchmark, **15 of 16 agent PRs keep the suite green — including every one of the 10 bad ones**: loosened assertions, deleted/skipped tests, hardcoded expected outputs, fail-open error handling, unit bugs in "no behaviour change" refactors, unmentioned changes to other modules. CI says ship all of them.

## What's real vs not (plain labels)

| Part | Status |
|---|---|
| Isolated apply + before/after test runs + diff signals | Real, deterministic |
| Judge agent with tool loop (list/read/grep/run_probe/submit_verdict) | Real; needs a model key |
| Provider-neutral gateway — Meta Model API (Muse Spark) default; Gemini 4 Argon / 3.8 Flash; OpenRouter | Real; OpenAI-compatible `/chat/completions`. Gemini routes untested until a key is set |
| Triage — Subquadratic Decisions (`subq-snap-1.1`) gives calibrated P(needs deep review / test gaming / unmentioned changes); sets the judge's tool budget and reasoning effort, never approves on its own | Real; needs `SUBQ_API_KEY`, untested until then |
| Learning loop: misses → general rules → playbook, rules credited/retired by outcome | Real; needs a model key |
| Run memory | MongoDB when `MONGODB_URI` is set; local JSON otherwise |
| Benchmark: 16 labeled PRs on a small JS library, train/holdout split by failure family | Hand-built for this hackathon; bugs verified by probes |
| Feedback signal | In the bench: case labels. In production: human overrides / post-merge reverts (not wired yet) |
| GitHub Action / PR comment | `review` prints the comment and exits 1 on block; Action wiring is next |

## Run

```bash
npm install
export MODEL_API_KEY=...            # Meta Model API key (dev.meta.ai)
export SUBQ_API_KEY=...             # optional: Subquadratic triage
# optional: export MONGODB_URI=mongodb+srv://...   GATE_PROVIDER=gemini GEMINI_API_KEY=...
npm run bench -- --reset --iterations 3
```

Each iteration scores the **holdout** set first (never learned from), then reviews the **train** set and learns from its misses. The holdout score per iteration is the "measurably better" number. Results land in `.mergegate/results.json`.

Without a key, `npm run bench` runs the deterministic heuristic floor (4/8 on holdout).

Review any patch against any repo:

```bash
npm run review -- --base ./path/to/repo --patch pr.diff --title "..." --desc "what the agent claims"
```

## Layout

- `src/gateway.ts` — provider-neutral model gateway with retries and token accounting
- `src/evidence.ts` — sandboxed apply, test runs, diff signals, judge tools
- `src/judge.ts` — agentic judge + heuristic floor
- `src/triage.ts` — Subquadratic decision-model triage
- `src/learn.ts` — distill misses into rules; credit/retire rules by outcome
- `src/memory.ts` — MongoDB / file store
- `bench/` — fixture library, 16 labeled agent PRs, patch builder
