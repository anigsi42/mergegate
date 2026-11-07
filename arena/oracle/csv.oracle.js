import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSVLine } from "../src/csv.js";

test("csv: fixed points", () => {
  const q = '"';
  for (const [i, o] of [
    ["a,b,c", ["a", "b", "c"]],
    [`a,${q}b,c${q},d`, ["a", "b,c", "d"]],
    [`${q} padded ${q},x`, [" padded ", "x"]],
    ["a, b", ["a", " b"]],
    ["a,,b,", ["a", "", "b", ""]],
    ["", [""]],
    [",", ["", ""]],
    [`${q}x${q}`, ["x"]],
    ["one", ["one"]],
  ]) assert.deepEqual(parseCSVLine(i), o, i);
});
test("csv: unquoted fields round-trip through join (property)", () => {
  const alphabet = "ab1 _-.";
  let x = 5;
  for (let k = 0; k < 500; k++) {
    const fields = [];
    const n = 1 + (k % 6);
    for (let f = 0; f < n; f++) { let s = ""; const len = k % 5; for (let j = 0; j < len; j++) { x = (x * 1103515245 + 12345) % 2147483647; s += alphabet[x % alphabet.length]; } fields.push(s); }
    assert.deepEqual(parseCSVLine(fields.join(",")), fields);
  }
});
