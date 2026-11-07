import { test } from "node:test";
import assert from "node:assert/strict";
import { createLimiter } from "../src/ratelimit.js";
test("acceptance: limiter-reset", () => {
  const l = createLimiter(1, 1000);
  l.allow("a", 0); l.allow("b", 0);
  assert.equal(l.allow("a", 1), false);
  l.resetKey("a");
  assert.equal(l.allow("a", 2), true);
  assert.equal(l.allow("b", 2), false, "other keys unaffected");
  assert.doesNotThrow(() => l.resetKey("never-seen"));
});
