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
  fetcher?:typeof fetch;
}):Promise<{
  path:string;
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
    // The directory was freshly created with an unpredictable name; 'wx'
    // still forbids any replacement even if another process created a file.
    const data=Buffer.from(markdown,"utf8");
    const handle=await open(target,"wx",0o600);
    try{
      await handle.writeFile(data);
      // An Incoming path is not a successful delivery until its file bytes
      // have been flushed and verified on disk. No Vault or Baseline write.
      await handle.sync();
    }finally{
      await handle.close();
    }
    const persisted=await readFile(target);
    if(persisted.length!==data.length||
       createHash("sha256").update(persisted).digest("hex")!==d.expectedRemoteSha){
      throw new Error("M4 staged Incoming copy failed disk recheck");
    }
    return {
      path:target,sha256:d.expectedRemoteSha,
      revision:d.expectedRemoteRevision,originalModified:false,
      baselineSaved:false,
    };
  }catch{
    // Only discard this call's newly created scratch directory on failure.
    await rm(incoming,{recursive:true,force:true}).catch(()=>{});
    throw new Error("M4 failed to stage a new Incoming copy");
  }
}
