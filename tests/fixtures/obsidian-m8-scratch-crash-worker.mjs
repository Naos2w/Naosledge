/**
 * Disposable subprocess fault injector for M8 P1 scratch incoming.
 * Never use against Production or a real Vault. The process exits abruptly
 * BEFORE or AFTER the scratch-only atomic rename, skipping all finally blocks.
 */
import {writeSync} from "node:fs";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {applyVerifiedProductionIncomingToScratch}
  from "../../lib/obsidian-m8-scratch-incoming-atomic.ts";
import {serializeObsidianMarkdown} from "../../lib/obsidian-markdown.ts";
import {RELEASE_NEON_BRANCH,RELEASE_DATA_API_URL}
  from "../../lib/neon/production-release.ts";

const root=process.argv[2],phase=process.argv[3];
if(!["before","after"].includes(phase)||
   typeof root!=="string"||
   !path.basename(root).startsWith("naosledge-m8-vault-test-")||
   path.dirname(path.resolve(root)).toLowerCase()!==
     path.resolve(tmpdir()).toLowerCase()){
  process.exit(50);
}
const sub="00000000-0000-4000-8000-000000000041";
const id="00000000-0000-4000-8000-000000000077";
const slug="m8-process-crash";
const stamp="2026-10-29T03:00:00Z";
const row={
  id,slug,title:"Process crash synthetic",
  summary:"only a test",content_md:"# Remote after crash\n",
  category:"test",tags:[],learned_on:"2026-10-29",
  updated_at:stamp,
};
const sha=x=>createHash("sha256").update(x).digest("hex");
const md=serializeObsidianMarkdown({
  slug,title:row.title,excerpt:row.summary,content_md:row.content_md,
  category:row.category,tags:row.tags,learned_on:row.learned_on,
});
const before="# Original before process exit\n";
const remoteSha=sha(md),remoteRevision=sha(id+":"+stamp);
const jwt="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".syntheticsignature";
const respond=(value,range)=>new Response(JSON.stringify(value),{
  status:200,headers:{"content-type":"application/json",
    "content-range":range},
});
const fetcher=async(uri,init)=>{
  if(init.method!=="GET"||
     new URL(uri).origin!==new URL(RELEASE_DATA_API_URL).origin)
    throw Error("Unexpected sandbox test transport");
  const u=new URL(uri);
  if(u.pathname.endsWith("/blog_admins"))
    return respond([{user_id:sub}],"0-0/1");
  if(u.pathname.endsWith("/knowledge_notes"))
    return respond([row],"0-0/1");
  throw Error("Unexpected scratch test URL");
};
const abrupt=async receipt=>{
  if(path.dirname(path.dirname(receipt)).toLowerCase()!==
       path.resolve(tmpdir()).toLowerCase()||
     !path.basename(path.dirname(receipt)).startsWith(
       "naosledge-m8-scratch-operation-")){
    throw Error("Crash test receipt outside OS TEMP");
  }
  const payload=await readFile(receipt,"utf8");
  if(!payload.includes("naosledge.m8.scratch-incoming-intent.v1"))
    throw Error("Missing durable recovery intent");
  // Synchronous stdout, not asynchronously flushed on process.exit().
  writeSync(1,"M8_CRASH_INTENT="+Buffer.from(receipt).toString("base64url")+"\n");
  process.exit(73);
};
await applyVerifiedProductionIncomingToScratch({
  branchId:RELEASE_NEON_BRANCH,ownerJwt:jwt,
  candidate:{
    slug,choice:"review-download",action:"download-replace",
    executable:false,automaticDeletionAllowed:false,
    requiresFreshTwoSidedRead:true,requiresDurableBackup:true,
    baselineCommitOnlyAfterVerifiedReadback:true,
    expectedLocalSha:sha(before),
    expectedRemoteSha:remoteSha,expectedRemoteRevision:remoteRevision,
  },
  scratchVaultRoot:root,fetcher,
  typedConfirmation:"TEST M8 SCRATCH download-replace "+slug+" "+remoteSha.slice(0,12),
  beforeCommitForTest:phase==="before"?abrupt:undefined,
  afterCommitForTest:phase==="after"?abrupt:undefined,
});
process.exit(40);
