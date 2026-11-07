import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSVLine } from "../src/csv.js";

test("splits simple line", () => {
  assert.deepEqual(parseCSVLine("a,b,c"), ["a", "b", "c"]);
});

test("keeps commas inside quotes", () => {
  assert.deepEqual(parseCSVLine('a,"b,c",d'), ["a", "b,c", "d"]);
});
