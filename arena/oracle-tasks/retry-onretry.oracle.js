import { test } from "node:test";
import assert from "node:assert/strict";
import { retry } from "../src/retry.js";
test("acceptance: retry-onretry", async () => {
  const calls = [];
  const errs = [];
  await assert.rejects(retry(async () => { const e = new Error("x" + errs.length); errs.push(e); throw e; }, { retries: 2, delayMs: 1, onRetry: (e, a) => calls.push([e, a]) }));
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], errs[0]); assert.equal(calls[0][1], 0);
  assert.equal(calls[1][0], errs[1]); assert.equal(calls[1][1], 1);
  let n = 0;
  await retry(async () => 1, { onRetry: () => n++ });
  assert.equal(n, 0);
  assert.equal(await retry(async () => 5, { retries: 1, delayMs: 1 }), 5);
});
