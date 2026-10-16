import test from "node:test";
import assert from "node:assert/strict";
import {
  sandboxResetRedirect, validRecoveryEmail,
  validRecoveryToken, validRecoveryPassword,
} from "../lib/neon/password-recovery.ts";

test("password recovery callback is pinned to explicit local sandbox origin", () => {
  assert.equal(sandboxResetRedirect("http://localhost:3015"), "http://localhost:3015/reset-password");
  assert.equal(sandboxResetRedirect("http://localhost:3000/"), "http://localhost:3000/reset-password");
  for(const url of [
    "https://naosledge.example", "http://127.0.0.1:3015",
    "http://localhost.evil.example", "http://user:pass@localhost:3000",
    "http://localhost:3000/x", "http://localhost:3000/?callback=https://evil.example",
    "http://localhost:3000/#token", "javascript:alert(1)", "not a URL",
  ]) assert.throws(() => sandboxResetRedirect(url), /Sandbox|網址/);
});

test("hosted password callbacks are pinned to the approved Vercel Preview and branch", () => {
  const allowed = {
    vercelEnv: "preview",
    vercelBranchHost: "naosledge-sandbox-preview-git-feat-initial-v3-site-20261015-naos-tsais-projects.vercel.app",
    gitRef: "feat/initial-v3-site-20261015",
    projectId: "prj_actualExample",
    authorizedProjectId: "prj_actualExample",
  };
  assert.equal(
    sandboxResetRedirect("", allowed),
    "https://naosledge-sandbox-preview-git-feat-initial-v3-site-20261015-naos-tsais-projects.vercel.app/reset-password",
  );
  const invalid = [
    {vercelEnv: "production"},
    {vercelEnv: "development"},
    {gitRef: "main"},
    {gitRef: "other-feature"},
    {projectId: "prj_someoneElse"},
    {authorizedProjectId: "prj_someoneElse"},
    {authorizedProjectId: ""},
    {vercelBranchHost: "evil.example"},
    {vercelBranchHost: "naosledge-sandbox-preview-.vercel.app.evil.com"},
    {vercelBranchHost: "https://naosledge-sandbox-preview-branch.vercel.app"},
    {vercelBranchHost: "naosledge-sandbox-preview-branch.vercel.app:8443"},
    {vercelBranchHost: "naosledge-sandbox-preview-branch.vercel.app/reset-password"},
    {vercelBranchHost: "naosledge-sandbox-preview-branch.vercel.app?token=abc"},
    {vercelBranchHost: "another-project-branch.vercel.app"},
  ];
  for(const override of invalid) {
    assert.throws(() => sandboxResetRedirect("", {...allowed,...override}), /Preview/);
  }
});

test("recovery email checks avoid invalid input and control characters", () => {
  assert.equal(validRecoveryEmail("owner@example.com"), true);
  assert.equal(validRecoveryEmail("owner+work@example.com"), true);
  for(const email of ["bad", "has spaces@example.com", "a@@example.com",
    "a@example.com\nX-Header: injected", "a@localhost", "a".repeat(257)+"@example.com",
    null, {}, ["owner@example.com"]]) {
    assert.equal(validRecoveryEmail(email), false);
  }
});

test("recovery token has a bounded URL-safe shape", () => {
  assert.equal(validRecoveryToken("abcDEFGH12345-_xyz89"), true);
  for(const token of ["", "short", "../../escape", "a".repeat(257), "a b", "a.b",
    "abcDEFGH12345-_xyz%3C", ["abcdefghijklmnop"], undefined]) {
    assert.equal(validRecoveryToken(token), false);
  }
});

test("new passwords have independent server-side bounds", () => {
  assert.equal(validRecoveryPassword("a long passphrase 123"), true);
  assert.equal(validRecoveryPassword("short-pass"), false);
  assert.equal(validRecoveryPassword("a".repeat(129)), false);
  assert.equal(validRecoveryPassword("a".repeat(12)+"\n"), false);
  assert.equal(validRecoveryPassword({length:30}), false);
});
