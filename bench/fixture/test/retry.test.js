import { test } from "node:test";
import assert from "node:assert/strict";
import { retry } from "../src/retry.js";

test("returns on first success", async () => {
  assert.equal(await retry(async () => 7), 7);
});

test("retries then succeeds", async () => {
  let n = 0;
  const v = await retry(async () => { if (n++ < 2) throw new Error("flaky"); return "ok"; }, { retries: 2, delayMs: 1 });
  assert.equal(v, "ok");
});

test("throws after exhausting retries", async () => {
  await assert.rejects(retry(async () => { throw new Error("down"); }, { retries: 1, delayMs: 1 }), /down/);
});
