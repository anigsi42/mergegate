import { test } from "node:test";
import assert from "node:assert/strict";
import { retry } from "../src/retry.js";

test("retry: first success, attempt index passed", async () => {
  const seen = [];
  assert.equal(await retry(async (a) => { seen.push(a); return "v"; }), "v");
  assert.deepEqual(seen, [0]);
});
test("retry: default is 2 retries (3 calls), rejects with the last error object", async () => {
  let n = 0;
  const errs = [];
  await assert.rejects(retry(async () => { const e = new Error("e" + n++); errs.push(e); throw e; }, { delayMs: 1 }), (e) => e === errs[2]);
  assert.equal(n, 3);
});
test("retry: honours retries option", async () => {
  for (const r of [0, 1, 4]) {
    let n = 0;
    await assert.rejects(retry(async () => { n++; throw new Error("x"); }, { retries: r, delayMs: 1 }));
    assert.equal(n, r + 1);
  }
});
test("retry: non-Error throws are still rejected, never resolved", async () => {
  for (const thrown of ["str", 42, null, undefined, { code: 1 }]) {
    let settled = "none";
    await retry(async () => { throw thrown; }, { retries: 1, delayMs: 1 }).then(() => (settled = "resolved"), (e) => { settled = "rejected"; assert.equal(e, thrown); });
    assert.equal(settled, "rejected", String(thrown));
  }
});
test("retry: succeeds after transient failures", async () => {
  let n = 0;
  assert.equal(await retry(async () => { if (n++ < 2) throw new Error("t"); return n; }, { retries: 2, delayMs: 1 }), 3);
});
test("retry: waits between attempts", async () => {
  const t0 = Date.now();
  await assert.rejects(retry(async () => { throw new Error("x"); }, { retries: 2, delayMs: 25 }));
  assert.ok(Date.now() - t0 >= 40, "expected ~2 delays");
});
