import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/slug.js";

test("slugify: fixed points", () => {
  for (const [i, o] of [["Hello World", "hello-world"], ["Ani's Notes", "anis-notes"], ["  --Launch!  ", "launch"], ["Rock & Roll", "rock-roll"], ["a/b", "a-b"], ["v1.2_beta", "v1-2-beta"], ["Top 10 Tips", "top-10-tips"], ["", ""], ["!!!", ""], ["Ship it!", "ship-it"], ["MiXeD CaSe", "mixed-case"]]) assert.equal(slugify(i), o, i);
});
test("slugify: output shape and idempotence (properties)", () => {
  const parts = ["a", "B", "7", " ", "-", "_", ".", "!", "&", "/", "'", "zz", "  ", "--"];
  let x = 11;
  for (let k = 0; k < 600; k++) {
    let t = "";
    const len = 1 + (k % 200);
    for (let j = 0; j < len; j++) { x = (x * 1103515245 + 12345) % 2147483647; t += parts[x % parts.length]; }
    const s = slugify(t);
    assert.match(s, /^([a-z0-9]+(-[a-z0-9]+)*)?$/, JSON.stringify(t) + " → " + JSON.stringify(s));
    assert.equal(slugify(s), s);
  }
});
test("slugify: rejects non-strings", () => {
  for (const bad of [null, undefined, 5, {}]) assert.throws(() => slugify(bad), TypeError);
});
