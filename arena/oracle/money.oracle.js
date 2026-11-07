import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, formatCents, addCents } from "../src/money.js";

test("parseAmount: valid inputs", () => {
  for (const [i, o] of [["0", 0], ["7", 700], ["12.3", 1230], ["12.34", 1234], ["$5", 500], ["$0.01", 1], ["-3.10", -310], ["-0.5", -50], ["123456789.99", 12345678999], ["$-2", -200]]) assert.equal(parseAmount(i), o, i);
});
test("parseAmount: rejects malformed", () => {
  for (const bad of ["", "-", ".", "abc", "1.234", "1.", "$$5", "1e3", "--1", "1-", "$"]) assert.throws(() => parseAmount(bad), undefined, JSON.stringify(bad));
});
test("parseAmount: rejects non-strings", () => {
  for (const bad of [5, null, undefined, {}, ["1"]]) assert.throws(() => parseAmount(bad), TypeError);
});
test("formatCents: fixed points", () => {
  for (const [i, o] of [[0, "$0.00"], [5, "$0.05"], [100, "$1.00"], [123456, "$1,234.56"], [-123456, "-$1,234.56"], [100000000, "$1,000,000.00"], [-5, "-$0.05"], [99999, "$999.99"]]) assert.equal(formatCents(i), o, String(i));
});
test("formatCents: rejects non-integers", () => {
  for (const bad of [1.5, NaN, Infinity, "5", null]) assert.throws(() => formatCents(bad), TypeError);
});
test("formatCents ∘ parseAmount round-trips", () => {
  let x = 7;
  for (let k = 0; k < 400; k++) {
    x = (x * 1103515245 + 12345) % 2147483647;
    const cents = (x % 2000000000) - 1000000000;
    const s = formatCents(cents);
    assert.match(s, /^-?\$\d{1,3}(,\d{3})*\.\d{2}$/);
    assert.equal(parseAmount(s.replace("$", "").replace(/,/g, "")), cents);
  }
});
test("addCents sums", () => {
  assert.equal(addCents(), 0);
  assert.equal(addCents(1, 2, 3), 6);
  assert.equal(addCents(-5, 5), 0);
});
test("money: large and boundary values", () => {
  assert.equal(addCents(2 ** 31, 2 ** 31), 2 ** 32);
  assert.equal(addCents(2 ** 52, 1), 2 ** 52 + 1);
  assert.equal(parseAmount("21474836.48"), 2147483648);
  assert.equal(formatCents(2 ** 53 - 1), "$90,071,992,547,409.91");
  assert.doesNotThrow(() => formatCents(2 ** 53));
  assert.equal(formatCents(-(2 ** 31)), "-$21,474,836.48");
});
test("parseAmount: currency symbol only as a prefix", () => {
  for (const bad of ["5$", "1$0", "5.00$", "$ 5"]) assert.throws(() => parseAmount(bad), undefined, bad);
});
