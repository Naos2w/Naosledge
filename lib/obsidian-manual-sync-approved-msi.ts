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
import {createHash} from "node:crypto";
import {lstat,readFile,realpath} from "node:fs/promises";
import path from "node:path";
import {readObsidianLocalManifest} from "./obsidian-local-manifest.ts";
import {inspectObsidianRegistration} from "./obsidian-vault-registration.ts";
import {
  fetchVerifiedNeonSandboxOwnerFingerprints,
  NEON_SYNC_SANDBOX_BRANCH,
} from "./obsidian-neon-sandbox-readonly.ts";
import {previewManualObsidianSync} from "./obsidian-manual-sync-review.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";
import {parseObsidianMarkdown,serializeObsidianMarkdown} from "./obsidian-markdown.ts";

// Exact path already approved in the pre-existing MSI-only read-only tool.
const APPROVED_MSI_VAULT="C:\\Naos\\Obsidian\\Naosledge";

/**
 * M3 receives the exact file that M1 fingerprinted from the pinned registered
 * Vault. This reader never accepts a caller path and never modifies a file.
 * It is invoked AGAIN after live remote Owner-RLS preflight, not from a
 * cached M2 browser snapshot.
 */
export async function readApprovedMsiCanonicalMarkdown(
  slug:string,expectedSha:string,
):Promise<string>{
  if(process.platform!=="win32"||hostname().trim().toUpperCase()!=="MSI"||
     typeof slug!=="string"||slug.length<3||slug.length>120||
     !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||
     typeof expectedSha!=="string"||!/^[a-f0-9]{64}$/.test(expectedSha)){
    throw Error("M3 approved MSI Vault note identity invalid");
  }
  const registryPath=path.join(process.env.APPDATA||
    path.join(homedir(),"AppData","Roaming"),"obsidian","obsidian.json");
  const registration=await inspectObsidianRegistration({
    vaultPath:APPROVED_MSI_VAULT,registryPath,
  });
  if(!registration.registered)throw Error("M3 registered MSI Vault is unavailable");
  const first=await readObsidianLocalManifest(APPROVED_MSI_VAULT);
  if(first.unsupportedMarkdownFiles||first.directoriesNotScanned||
     first.fingerprints.find(item=>item.slug===slug)?.sha256!==expectedSha){
    throw Error("M3 local Vault fingerprint differs from reviewed M2 intent");
  }
  const file=path.join(APPROVED_MSI_VAULT,slug+".md");
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
     stat.size<1||stat.size>250_000||
     path.normalize(await realpath(file)).toLowerCase()!==path.normalize(file).toLowerCase()){
    throw Error("M3 reviewed Vault file unsafe");
  }
  const bytes=await readFile(file);
  const final=await lstat(file);
  const digest=createHash("sha256").update(bytes).digest("hex");
  if(final.ino!==stat.ino||final.size!==stat.size||
     final.mtimeMs!==stat.mtimeMs||digest!==expectedSha){
    throw Error("M3 reviewed Vault file changed during read");
  }
  const markdown=bytes.toString("utf8");
  const parsed=parseObsidianMarkdown(markdown,slug+".md","1970-01-01");
  if(!parsed||parsed.metadata.slug!==slug||
     serializeObsidianMarkdown({...parsed.metadata,content_md:parsed.content_md})!==markdown){
    throw Error("M3 Vault note is not canonical portable Markdown");
  }
  return markdown;
}

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
