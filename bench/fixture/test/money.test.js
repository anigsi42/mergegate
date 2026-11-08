import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, formatCents, addCents, toDollars } from "../src/money.js";

test("parses whole and fractional amounts", () => {
  assert.equal(parseAmount("12.34"), 1234);
  assert.equal(parseAmount("$5"), 500);
  assert.equal(parseAmount("0.5"), 50);
});

test("no leading zero", () => {
  assert.equal(parseAmount(".5"), 50);
  assert.equal(parseAmount("$.25"), 25);
});

test("parses negatives", () => {
  assert.equal(parseAmount("-3.10"), -310);
});

test("rejects garbage", () => {
  assert.throws(() => parseAmount("12.345"));
  assert.throws(() => parseAmount("abc"));
});

test("formats with separators", () => {
  assert.equal(formatCents(123456), "$1,234.56");
  assert.equal(formatCents(-5), "-$0.05");
});

test("adds", () => {
  assert.equal(addCents(1, 2, 3), 6);
});

test("toDollars (deprecated)", () => {
  assert.equal(toDollars(250), 2.5);
});
