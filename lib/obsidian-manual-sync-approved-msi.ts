/**
 * M1 explicit, read-only wiring for the already Owner-approved MSI device.
 * Never call at import time. There are NO write, delete, download, upload,
 * login, token persistence, arbitrary vault path or Production APIs here.
 *
 * This adapter is intentionally NOT enabled from a website route, CLI or
 * background job. The owner will manually invoke a reviewed client after
 * Sandbox acceptance. Until then this is a callable contract, not live sync.
 */
import {homedir,hostname} from "node:os";
import path from "node:path";
import {readObsidianLocalManifest} from "./obsidian-local-manifest.ts";
import {inspectObsidianRegistration} from "./obsidian-vault-registration.ts";
import {
  fetchVerifiedNeonSandboxOwnerFingerprints,
  NEON_SYNC_SANDBOX_BRANCH,
} from "./obsidian-neon-sandbox-readonly.ts";
import {previewManualObsidianSync} from "./obsidian-manual-sync-review.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";

// Exact path already approved in the pre-existing MSI-only read-only tool.
const APPROVED_MSI_VAULT="C:\\Naos\\Obsidian\\Naosledge";

export async function previewApprovedMsiSandboxSync(args:{
  /** Short-lived Sandbox OWNER JWT provided explicitly for this invocation. */
  sandboxOwnerJwt:string;
  /** Explicit last-confirmed common fingerprint; never inferred or persisted. */
  baseline:SyncFingerprint[];
}){
  // Gate before evaluating JWT, filesystem readers, registry or HTTP.
  if(process.platform!=="win32"||hostname().trim().toUpperCase()!=="MSI"){
    throw Error("M1 preview is restricted to the Owner-approved MSI Windows device");
  }
  if(!args||typeof args.sandboxOwnerJwt!=="string"||
     !Array.isArray(args.baseline)){
    throw Error("M1 requires an explicit Sandbox owner session and baseline");
  }
  const registryPath=path.join(process.env.APPDATA||
    path.join(homedir(),"AppData","Roaming"),"obsidian","obsidian.json");
  const registered=await inspectObsidianRegistration({
    vaultPath:APPROVED_MSI_VAULT,registryPath,
  });
  if(!registered.registered){
    throw Error("Approved Obsidian Vault GUI registration is not verified");
  }
  // There is intentionally no configurable target folder or API URL.
  // The remote module pins its endpoint to the approved Neon Sandbox, and
  // performs GET with Owner JWT through RLS only. Any failure halts preview.
  return await previewManualObsidianSync({
    readLocal:()=>readObsidianLocalManifest(APPROVED_MSI_VAULT),
    readRemote:async()=>{
      // Proof and inventory are inseparable: a non-owner may receive 200 + []
      // from knowledge_notes RLS and must never be treated as a valid Owner.
      return fetchVerifiedNeonSandboxOwnerFingerprints({
        branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:args.sandboxOwnerJwt,
      });
    },
    baseline:args.baseline,
  });
}
