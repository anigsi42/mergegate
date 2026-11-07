import { test } from "node:test";
import assert from "node:assert/strict";
import { retry } from "../src/retry.js";
const timed = async (opts) => { const t = Date.now(); await assert.rejects(retry(async () => { throw new Error("x"); }, opts)); return Date.now() - t; };
test("acceptance: retry-backoff", async () => {
  const exp = await timed({ retries: 3, delayMs: 20, backoff: "exponential" }); // 20+40+80=140
  assert.ok(exp >= 125, "exponential total " + exp);
  const fixed = await timed({ retries: 3, delayMs: 20 }); // 60
  assert.ok(fixed >= 50 && fixed < 125, "fixed total " + fixed);
  const fx = await timed({ retries: 3, delayMs: 20, backoff: "fixed" });
  assert.ok(fx >= 50 && fx < 125, "explicit fixed " + fx);
});
