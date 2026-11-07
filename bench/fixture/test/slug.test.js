import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.js";

test("basic slug", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("drops apostrophes", () => {
  assert.equal(slugify("Ani's Notes"), "anis-notes");
});

test("trims edge dashes", () => {
  assert.equal(slugify("  --Launch!  "), "launch");
});
