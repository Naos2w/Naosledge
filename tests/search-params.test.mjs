import test from "node:test";
import assert from "node:assert/strict";
import { normalizedQueryParam } from "../lib/search-params.ts";

test("search text is trimmed and capped", () => {
  assert.equal(normalizedQueryParam("  Git rebase  ", 80), "Git rebase");
  assert.equal(normalizedQueryParam("abcde", 3), "abc");
});

test("repeated query parameters use only their first string value", () => {
  assert.equal(normalizedQueryParam(["first", "second"], 80), "first");
  assert.equal(normalizedQueryParam(["", "second"], 80), "");
});

test("malformed searchParams cannot crash the homepage", () => {
  for (const unexpected of [undefined, null, 4, {}, ["a", "b"], [["nested"], "valid"], [null, "valid"]]) {
    const result = normalizedQueryParam(unexpected, 80);
    assert.equal(typeof result, "string");
  }
  assert.equal(normalizedQueryParam(null, 80), "");
  assert.equal(normalizedQueryParam({ trim: null }, 80), "");
  assert.equal(normalizedQueryParam(["nested", "safe"], 80), "nested");
});
