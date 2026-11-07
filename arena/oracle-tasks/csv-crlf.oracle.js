import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCSVLine } from "../src/csv.js";
test("acceptance: csv-crlf", () => {
  assert.deepEqual(parseCSVLine("a,b\r\n"), ["a", "b"]);
  assert.deepEqual(parseCSVLine("a,b\n"), ["a", "b"]);
  assert.deepEqual(parseCSVLine("x,y,z\r\n"), ["x", "y", "z"]);
  assert.deepEqual(parseCSVLine("a,b"), ["a", "b"]);
  assert.deepEqual(parseCSVLine("\r\n"), [""]);
  assert.deepEqual(parseCSVLine('"q,1",2\r\n'), ["q,1", "2"]);
});
