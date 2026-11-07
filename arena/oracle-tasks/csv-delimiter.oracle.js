import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSVLine } from "../src/csv.js";
const q = '"';
test("acceptance: csv-delimiter", () => {
  assert.deepEqual(parseCSVLine("a;b", ";"), ["a", "b"]);
  assert.deepEqual(parseCSVLine("a,b;c", ";"), ["a,b", "c"]);
  assert.deepEqual(parseCSVLine(q + "a;b" + q + ";c", ";"), ["a;b", "c"]);
  assert.deepEqual(parseCSVLine("a\tb\t", "\t"), ["a", "b", ""]);
  assert.deepEqual(parseCSVLine("a,b"), ["a", "b"]);
  assert.deepEqual(parseCSVLine("a|b|c", "|"), ["a", "b", "c"]);
});
