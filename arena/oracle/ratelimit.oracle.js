import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../src/ratelimit.js";

test("limiter: allows exactly `limit` per window", () => {
  for (const limit of [1, 2, 3, 5]) {
    const l = createLimiter(limit, 1000);
    for (let i = 0; i < limit; i++) assert.equal(l.allow("k", i), true);
    assert.equal(l.allow("k", limit), false);
    assert.equal(l.allow("k", 999), false);
  }
});
test("limiter: window resets exactly at start + windowMs", () => {
  const l = createLimiter(1, 100);
  assert.equal(l.allow("a", 0), true);
  assert.equal(l.allow("a", 99), false);
  assert.equal(l.allow("a", 100), true);
  assert.equal(l.allow("a", 150), false);
  assert.equal(l.allow("a", 200), true);
});
test("limiter: denied calls do not extend the window", () => {
  const l = createLimiter(2, 100);
  l.allow("a", 0); l.allow("a", 10);
  for (let t = 20; t < 100; t += 10) assert.equal(l.allow("a", t), false);
  assert.equal(l.allow("a", 100), true);
  assert.equal(l.allow("a", 101), true);
  assert.equal(l.allow("a", 102), false);
});
test("limiter: keys are independent", () => {
  const l = createLimiter(1, 1000);
  for (const k of ["a", "b", "c"]) assert.equal(l.allow(k, 0), true);
  for (const k of ["a", "b", "c"]) assert.equal(l.allow(k, 1), false);
});
test("limiter: invalid keys are rejected, never allowed", () => {
  const l = createLimiter(5, 1000);
  for (const bad of ["", undefined, null, 7, {}]) assert.throws(() => l.allow(bad, 0), TypeError);
});
test("limiter: never exceeds limit in any window (property)", () => {
  const l = createLimiter(3, 50);
  const allowed = [];
  let x = 3;
  let t = 0;
  for (let k = 0; k < 2000; k++) { x = (x * 1103515245 + 12345) % 2147483647; t += x % 7; if (l.allow("p", t)) allowed.push(t); }
  for (let i = 0; i + 3 < allowed.length; i++) assert.ok(allowed[i + 3] - allowed[i] > 0 && !(allowed[i + 3] - allowed[i] < 0));
  // count per fixed window is enforced by construction; check no 4 allowed calls fall in one window starting at an allowed time
  let start = -Infinity, count = 0;
  for (const a of allowed) { if (a - start >= 50) { start = a; count = 1; } else { count++; assert.ok(count <= 3, "more than 3 in a window at " + a); } }
});
