import test from "node:test";
import assert from "node:assert/strict";
import { safeMarkdownImageSrc } from "../lib/markdown-image.ts";

test("allows HTTPS image URLs and strips harmless surrounding whitespace", () => {
  assert.equal(
    safeMarkdownImageSrc(" https://images.example.invalid/flow.svg?size=720 "),
    "https://images.example.invalid/flow.svg?size=720",
  );
  assert.equal(
    safeMarkdownImageSrc("https://cdn.example.org/image%20one.webp"),
    "https://cdn.example.org/image%20one.webp",
  );
});

test("allows same-origin absolute paths but no protocol-relative sources", () => {
  assert.equal(safeMarkdownImageSrc("/media/flow.png"), "/media/flow.png");
  assert.equal(safeMarkdownImageSrc("/images/fig.svg#view"), "/images/fig.svg#view");
  for (const value of ["//tracker.example.org/spy.gif", "/\\evil.example/image.png", "\\evil.example"]) {
    assert.equal(safeMarkdownImageSrc(value), null, value);
  }
});

test("rejects data, script, HTTP, local network, credentialed and malformed URLs", () => {
  for (const value of [
    undefined, null, 123, {}, "", "   ",
    "javascript:alert(1)", "data:image/svg+xml,<svg/>",
    "blob:https://example.org/a", "file:///C:/secret.png",
    "http://cdn.example.org/file.png", "http://127.0.0.1/image.png",
    "https://localhost:5000/image.png", "https://192.168.1.2/image.jpg",
    "https://[::1]/image.png", "https://router.local/image.png",
    "https://a.localhost/image.png", "https://user:password@cdn.example.org/photo.jpg",
    "images/example.jpg", "https://example.org/\nimage.jpg",
  ]) assert.equal(safeMarkdownImageSrc(value), null, String(value));
});
