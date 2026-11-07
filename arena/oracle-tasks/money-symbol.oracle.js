import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCents } from "../src/money.js";
test("acceptance: money-symbol", () => {
  assert.equal(formatCents(500, { symbol: "€" }), "€5.00");
  assert.equal(formatCents(-500, { symbol: "€" }), "-€5.00");
  assert.equal(formatCents(123456, { symbol: "£" }), "£1,234.56");
  assert.equal(formatCents(500, { symbol: "" }), "5.00");
  assert.equal(formatCents(500, {}), "$5.00");
  assert.equal(formatCents(500), "$5.00");
  assert.throws(() => formatCents(1.5, { symbol: "€" }), TypeError);
});
