import { test } from "node:test";
import assert from "node:assert/strict";
import { addCents } from "../src/money.js";
test("acceptance: money-validate-add", () => {
  for (const bad of [[1.5], [1, "2"], [NaN], [Infinity], [null], [undefined], [1, 2, 0.1]]) assert.throws(() => addCents(...bad), TypeError, JSON.stringify(bad));
  assert.equal(addCents(), 0);
  assert.equal(addCents(2 ** 53), 2 ** 53);
  assert.equal(addCents(-7, 7, 100), 100);
});
