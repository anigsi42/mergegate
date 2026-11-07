import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount } from "../src/money.js";
test("acceptance: money-commas", () => {
  for (const [i, o] of [["1,234.50", 123450], ["1,234,567.89", 123456789], ["$12,345", 1234500], ["-1,000", -100000], ["999", 99900], ["1234.50", 123450], ["12,345,678", 1234567800]]) assert.equal(parseAmount(i), o, i);
  for (const bad of ["1,23", "12,3456", ",123", "1,,234", "1,234,", "1,234.5,0", "1234,567", "1,2345"]) assert.throws(() => parseAmount(bad), undefined, bad);
});
