import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.js";
test("acceptance: slug-maxlen", () => {
  assert.equal(slugify("hello world", 6), "hello");
  assert.equal(slugify("hello world", 5), "hello");
  assert.equal(slugify("hello world", 11), "hello-world");
  const long = "word ".repeat(80);
  assert.ok(slugify(long).length > 300, "default must not truncate");
  for (let n = 1; n <= 40; n++) for (const t of ["a b c d e f g h i j k", "Rock & Roll Forever", "x".repeat(50), "ab-cd-ef-gh"]) {
    const s = slugify(t, n);
    assert.ok(s.length <= n, t + " " + n);
    assert.match(s, /^([a-z0-9]+(-[a-z0-9]+)*)?$/, JSON.stringify([t, n, s]));
  }
});
