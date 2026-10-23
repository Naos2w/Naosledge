import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {previewApprovedMsiSandboxSync} from "../lib/obsidian-manual-sync-approved-msi.ts";

const source=fileURLToPath(new URL("../lib/obsidian-manual-sync-approved-msi.ts",import.meta.url));

// The actual MSI host is tested separately after a legitimate product branch
// is available. This test is a fail-closed contract on Linux/other machines.
test("off-device M1 adapter refuses before attempting any Vault or Neon reads",{
  skip:process.platform==="win32"?"Host-rejection test is for non-Windows CI":false
},async()=>{
  await assert.rejects(previewApprovedMsiSandboxSync({
    sandboxOwnerJwt:"test.sandbox.signature",baseline:[],
  }),/restricted to the Owner-approved MSI Windows device/);
});

test("approved MSI adapter pins the exact Vault, registration and Neon Sandbox readers",async()=>{
  const src=await readFile(source,"utf8");
  assert.match(src,/APPROVED_MSI_VAULT="C:\\\\Naos\\\\Obsidian\\\\Naosledge"/);
  assert.match(src,/hostname\(\).*toUpperCase\(\)!=="MSI"/);
  assert.match(src,/inspectObsidianRegistration/);
  assert.match(src,/readObsidianLocalManifest\(APPROVED_MSI_VAULT\)/);
  assert.match(src,/fetchNeonSandboxFingerprints/);
  assert.match(src,/branchId:NEON_SYNC_SANDBOX_BRANCH/);
  assert.match(src,/previewManualObsidianSync/);
  assert.doesNotMatch(src,/\bPOST\b|\bPATCH\b|\bDELETE\b|writeFile\(|rename\(|rm\(|setInterval\(|setTimeout\(/);
  assert.doesNotMatch(src,/\bhttps?:\/\/|NEXT_PUBLIC|localStorage|sessionStorage/i);
});
