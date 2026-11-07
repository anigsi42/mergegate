import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../src/ratelimit.js";
test("acceptance: limiter-remaining", () => {
  const l = createLimiter(3, 100);
  assert.equal(l.remaining("a", 0), 3);
  assert.equal(l.remaining("a", 0), 3, "must not consume");
  l.allow("a", 0);
  assert.equal(l.remaining("a", 1), 2);
  l.allow("a", 2); l.allow("a", 3); l.allow("a", 4);
  assert.equal(l.remaining("a", 5), 0);
  assert.equal(l.remaining("a", 100), 3, "expired window");
  assert.equal(l.remaining("b", 5), 3);
  assert.equal(l.allow("a", 6), false);
  for (const bad of ["", null, 7]) assert.throws(() => l.remaining(bad, 0), TypeError);
});
