/**
 * M4: stage ONE manually approved Neon Sandbox note as a new Incoming copy.
 *
 * This never takes a Vault path, writes an original note, applies a Baseline,
 * resolves a conflict or calls any non-Sandbox API. An approved caller may
 * show the resulting private per-user temporary file for manual inspection.
 * This module is not invoked from web routes or background automation.
 */
import {createHash} from "node:crypto";
import {mkdtemp,open,readFile,realpath,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import type {SyncDecision} from "./obsidian-sync-plan.ts";
import {
  fetchVerifiedNeonSandboxMarkdown,NEON_SYNC_SANDBOX_BRANCH,
} from "./obsidian-neon-sandbox-readonly.ts";

export async function stageNeonSandboxIncoming(args:{
  branchId:string;
  sandboxOwnerJwt:string;
  decision:SyncDecision;
  typedConfirmation:string;
  /** Optional caller-supplied local bytes: conflict-only, never read from Vault. */
  localMarkdown?:string;
  fetcher?:typeof fetch;
}):Promise<{
  path:string;
  /** Independent local conflict snapshot, never the Vault original. */
  localCopyPath:string|null;
  sha256:string;
  revision:string;
  originalModified:false;
  baselineSaved:false;
}>{
  // Keep the exact approved primitives across asynchronous remote reads.
  // A caller must not redirect the filename or returned evidence mid-flight.
  const d=args?.decision?{...args.decision}:undefined;
  // The CLI validates these relationships, but this exported staging API must
  // not trust a different future caller to supply a consistent M2 decision.
  const fields=[
    "slug","choice","manualReview","expectedLocalSha",
    "expectedRemoteSha","expectedRemoteRevision",
  ];
  if(!args||args.branchId!==NEON_SYNC_SANDBOX_BRANCH||!d||
     Object.keys(d).length!==fields.length||
     !fields.every(field=>Object.hasOwn(d,field))||
     !["review-download","review-missing-local","conflict"].includes(d.choice)||
     d.manualReview!==true||
     typeof d.slug!=="string"||d.slug.length<3||d.slug.length>120||
     !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.slug)||
     typeof d.expectedRemoteSha!=="string"||
     !/^[0-9a-f]{64}$/.test(d.expectedRemoteSha)||
     typeof d.expectedRemoteRevision!=="string"||
     !/^[0-9a-f]{64}$/.test(d.expectedRemoteRevision)||
     (d.expectedLocalSha!==null&&
       (typeof d.expectedLocalSha!=="string"||
        !/^[0-9a-f]{64}$/.test(d.expectedLocalSha)))||
     (d.choice==="review-missing-local")!==(d.expectedLocalSha===null)||
     (d.expectedLocalSha!==null&&d.expectedLocalSha===d.expectedRemoteSha)||
     args.typedConfirmation!=="SAVE SANDBOX INCOMING "+d.slug){
    throw new Error("M4 requires a fresh per-note Incoming confirmation");
  }

  // An optional conflict pair is frozen and hash-checked before any Owner GET.
  // We cannot certify that the actual Vault is unchanged: the caller supplies
  // this exact local snapshot voluntarily, without a path or filesystem read.
  if(args.localMarkdown!==undefined&&
     (d.choice!=="conflict"||typeof args.localMarkdown!=="string")){
    throw new Error("M4 local snapshot is only allowed for a conflict");
  }
  const localBytes=args.localMarkdown===undefined?null:
    Buffer.from(args.localMarkdown,"utf8");
  if(localBytes&&
     (localBytes.length>250_000||
      createHash("sha256").update(localBytes).digest("hex")!==d.expectedLocalSha)){
    throw new Error("M4 local conflict snapshot differs from reviewed SHA");
  }

  const markdown=await fetchVerifiedNeonSandboxMarkdown({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,
    slug:d.slug,expectedSha256:d.expectedRemoteSha,
    expectedRevision:d.expectedRemoteRevision,fetcher:args.fetcher,
  });

  // No configurable destination: never stage directly into Obsidian or a
  // guessed Downloads directory. Resolve the OS temp folder first to reject
  // a configured temp root redirected into the known private Vault.
  const root=await realpath(tmpdir());
  const vault=path.win32.normalize("C:\\Naos\\Obsidian\\Naosledge").toLowerCase();
  const actual=path.win32.normalize(root).toLowerCase();
  if(actual===vault||actual.startsWith(vault+"\\")){
    throw new Error("M4 temporary Incoming root must not be the Obsidian Vault");
  }
  const incoming=await mkdtemp(path.join(root,"naosledge-sandbox-incoming-"));
  try{
    const target=path.join(incoming,d.slug+".md");
    const localCopyPath=localBytes?path.join(incoming,d.slug+"--local.md"):null;
    // Each copy is exclusively created and fsynced, then re-read from disk.
    // A failure discards this entire new Incoming directory, never the Vault.
    const stageFile=async(filename:string,data:Buffer,expectedSha:string)=>{
      const handle=await open(filename,"wx",0o600);
      try{
        await handle.writeFile(data);
        await handle.sync();
      }finally{
        await handle.close();
      }
      const persisted=await readFile(filename);
      if(persisted.length!==data.length||
         createHash("sha256").update(persisted).digest("hex")!==expectedSha){
        throw new Error("M4 staged Incoming copy failed disk recheck");
      }
    };
    await stageFile(target,Buffer.from(markdown,"utf8"),d.expectedRemoteSha);
    if(localCopyPath&&localBytes){
      await stageFile(localCopyPath,localBytes,d.expectedLocalSha!);
    }
    return {
      path:target,localCopyPath,sha256:d.expectedRemoteSha,
      revision:d.expectedRemoteRevision,originalModified:false,
      baselineSaved:false,
    };
  }catch{
    // Only discard this call's newly created scratch directory on failure.
    await rm(incoming,{recursive:true,force:true}).catch(()=>{});
    throw new Error("M4 failed to stage a new Incoming copy");
  }
}
