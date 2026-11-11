import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../src/ratelimit.js";

test("limits within a window", () => {
  const l = createLimiter(2, 1000);
  assert.equal(l.allow("a", 0), true);
  assert.equal(l.allow("a", 1), true);
  assert.equal(l.allow("a", 2), false);
});

test("window resets after windowMs", () => {
  const l = createLimiter(1, 100);
  assert.equal(l.allow("a", 0), true);
  assert.equal(l.allow("a", 50), false);
  assert.equal(l.allow("a", 100), true);
});

test("keys are independent", () => {
  const l = createLimiter(1, 1000);
  assert.equal(l.allow("a", 0), true);
  assert.equal(l.allow("b", 0), true);
});

test("requires a key", () => {
  const l = createLimiter(1, 1000);
  assert.throws(() => l.allow(""));
});
