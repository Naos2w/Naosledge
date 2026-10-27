/**
 * M5: durable, metadata-only witness of an explicitly approved M3 Sandbox
 * transfer that has already passed the transport's remote post-write GET.
 *
 * An OS scratch witness survives a Node restart, but is self-reported: it is
 * NOT a signed authorization record, an Obsidian Vault read, or a Baseline.
 * Future manual inspection must re-read both supplied local bytes and the
 * pinned Owner-RLS Sandbox. No code here writes a real sync Baseline.
 */
import {createHash} from "node:crypto";
import {lstat,mkdtemp,open,readFile,realpath,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {parseObsidianMarkdown,serializeObsidianMarkdown} from "./obsidian-markdown.ts";
import {
  fetchVerifiedNeonSandboxMarkdown,fetchVerifiedNeonSandboxOwnerFingerprints,
  NEON_SYNC_SANDBOX_BRANCH,
} from "./obsidian-neon-sandbox-readonly.ts";

const PREFIX="naosledge-sandbox-m3-witness-";
const FILENAME="transfer-witness.json";
const HASH=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
type Action="manual-create"|"manual-update";
type Witness={
  format:"naosledge.m5.m3-transfer-witness.v1";
  sandboxBranch:string;
  source:"manual-scratch-stdin";
  action:Action;
  slug:string;
  sha256:string;
  revision:string;
  baselineSaved:false;
};

function validWitness(value:unknown):value is Witness{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const keys=["format","sandboxBranch","source","action","slug","sha256",
    "revision","baselineSaved"];
  return Object.keys(v).length===keys.length&&
    keys.every(key=>Object.hasOwn(v,key))&&
    v.format==="naosledge.m5.m3-transfer-witness.v1"&&
    v.sandboxBranch===NEON_SYNC_SANDBOX_BRANCH&&
    v.source==="manual-scratch-stdin"&&
    (v.action==="manual-create"||v.action==="manual-update")&&
    typeof v.slug==="string"&&v.slug.length>=3&&v.slug.length<=120&&
    SLUG.test(v.slug)&&typeof v.sha256==="string"&&HASH.test(v.sha256)&&
    typeof v.revision==="string"&&HASH.test(v.revision)&&
    v.baselineSaved===false;
}

function digest(bytes:Buffer|string):string{
  return createHash("sha256").update(bytes).digest("hex");
}

/** Called ONLY after a manual M3 transfer returned successfully. */
export async function storeVerifiedM3SandboxWitness(args:{
  action:Action;slug:string;sha256:string;revision:string;
}):Promise<{receiptPath:string;baselineSaved:false}>{
  const witness={
    format:"naosledge.m5.m3-transfer-witness.v1",
    sandboxBranch:NEON_SYNC_SANDBOX_BRANCH,source:"manual-scratch-stdin",
    ...args,baselineSaved:false,
  };
  if(!validWitness(witness)){
    throw Error("M5 requires a verified single-note Sandbox transfer");
  }
  const root=await realpath(tmpdir());
  const vault=path.win32.normalize("C:\\Naos\\Obsidian\\Naosledge").toLowerCase();
  const actual=path.win32.normalize(root).toLowerCase();
  if(actual===vault||actual.startsWith(vault+"\\")){
    throw Error("M5 scratch witness may not be placed in the real Vault");
  }
  const folder=await mkdtemp(path.join(root,PREFIX));
  try{
    const receiptPath=path.join(folder,FILENAME);
    const bytes=Buffer.from(JSON.stringify(witness),"utf8");
    const file=await open(receiptPath,"wx",0o600);
    try{await file.writeFile(bytes);await file.sync();}
    finally{await file.close();}
    if(!(await readFile(receiptPath)).equals(bytes)){
      throw Error("M5 transfer witness write could not be verified");
    }
    return {receiptPath,baselineSaved:false};
  }catch{
    await rm(folder,{recursive:true,force:true}).catch(()=>{});
    throw Error("M5 transfer witness could not be persisted; inspect M3 result manually");
  }
}

async function readScratchWitness(receiptPath:string):Promise<{witness:Witness;raw:Buffer}>{
  if(typeof receiptPath!=="string"||receiptPath.length>2048){
    throw Error("M5 requires a bounded private transfer witness path");
  }
  const root=await realpath(tmpdir());
  const file=path.resolve(receiptPath);
  const folder=path.dirname(file);
  if(path.basename(file)!==FILENAME||
     path.dirname(folder).toLowerCase()!==root.toLowerCase()||
     !/^naosledge-sandbox-m3-witness-[a-zA-Z0-9_-]{6}$/.test(path.basename(folder))||
     (await realpath(folder)).toLowerCase()!==folder.toLowerCase()){
    throw Error("M5 transfer witness must be an isolated OS scratch file");
  }
  const before=await lstat(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size>2048){
    throw Error("M5 transfer witness file is unsafe");
  }
  const raw=await readFile(file);
  const after=await lstat(file);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||
     before.ino!==after.ino){
    throw Error("M5 transfer witness changed during read");
  }
  let parsed:unknown;
  try{parsed=JSON.parse(raw.toString("utf8")) as unknown;}
  catch{throw Error("M5 transfer witness is not valid JSON");}
  if(!validWitness(parsed)||JSON.stringify(parsed)!==raw.toString("utf8")){
    throw Error("M5 transfer witness is malformed or noncanonical");
  }
  return {witness:parsed,raw};
}

/**
 * Separate, restart-safe manual check of CURRENT equality. The owner provides
 * canonical scratch Markdown again, and the live RLS adapter reauthenticates
 * + GETs the exact original note and current remote inventory. An unchanged
 * local scratch string is NOT evidence that a real Vault was updated.
 */
export async function reverifyM3SandboxWitness(args:{
  receiptPath:string;
  localMarkdown:string;
  sandboxOwnerJwt:string;
  fetcher?:typeof fetch;
}):Promise<{
  matchesCurrentScratchPair:true;baselineSaved:false;
  provenance:"self-reported-m3-witness";
}>{
  const {witness,raw}=await readScratchWitness(args.receiptPath);
  if(typeof args.localMarkdown!=="string"||
     Buffer.byteLength(args.localMarkdown,"utf8")>250_000||
     digest(args.localMarkdown)!==witness.sha256){
    throw Error("M5 current supplied scratch Markdown differs from M3 witness");
  }
  const parsed=parseObsidianMarkdown(
    args.localMarkdown,witness.slug+".md","1970-01-01",
  );
  if(!parsed||parsed.metadata.slug!==witness.slug||
     serializeObsidianMarkdown({...parsed.metadata,content_md:parsed.content_md})!==
       args.localMarkdown){
    throw Error("M5 scratch Markdown is not the canonical reviewed note");
  }
  const remote=await fetchVerifiedNeonSandboxMarkdown({
    branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:args.sandboxOwnerJwt,
    slug:witness.slug,expectedSha256:witness.sha256,
    expectedRevision:witness.revision,fetcher:args.fetcher,
  });
  if(digest(remote)!==witness.sha256||
     !(await readFile(args.receiptPath)).equals(raw)){
    throw Error("M5 witness or remote changed during cross-process recheck");
  }
  return {matchesCurrentScratchPair:true,baselineSaved:false,
    provenance:"self-reported-m3-witness"};
}

/**
 * M6 failure recovery: POST/PATCH may commit and then lose its response,
 * including a lost M5 witness. There is NO safe automatic retry.
 *
 * This only observes the currently RLS-visible remote bytes relative to a
 * separately supplied canonical Scratch note. Even an equal SHA cannot prove
 * the uncertain transfer happened, who approved it, or that the real Vault is
 * equal. Consequently it NEVER creates/imports a Baseline or authorizes retry.
 */
export async function inspectUncertainM3SandboxOutcome(args:{
  sandboxOwnerJwt:string;
  localMarkdown:string;
  /** The SHA from the prior manually reviewed M2 decision, not a trust token. */
  reviewedLocalSha:string;
  fetcher?:typeof fetch;
}):Promise<{
  currentRemoteState:"matches-supplied-scratch"|"different-now"|"absent-now";
  ownerRlsReadOnly:true;
  transferConfirmed:false;
  baselineSaved:false;
  automaticRetryAllowed:false;
}>{
  if(!args||typeof args.localMarkdown!=="string"||
     Buffer.byteLength(args.localMarkdown,"utf8")>250_000){
    throw Error("M6 requires canonical portable Scratch Markdown");
  }
  const parsed=parseObsidianMarkdown(args.localMarkdown,"scratch.md","1970-01-01");
  if(!parsed||serializeObsidianMarkdown({
    ...parsed.metadata,content_md:parsed.content_md,
  })!==args.localMarkdown){
    throw Error("M6 requires canonical portable Scratch Markdown");
  }
  const slug=parsed.metadata.slug;
  const localHash=digest(args.localMarkdown);
  if(typeof args.reviewedLocalSha!=="string"||!HASH.test(args.reviewedLocalSha)||
     localHash!==args.reviewedLocalSha){
    throw Error("M6 requires canonical portable Scratch Markdown matching its reviewed SHA");
  }
  // Verify Owner-RLS independently for each complete inventory; a 200 + []
  // by itself could be a revoked grant, a partial listing, or a denied user.
  const read=()=>fetchVerifiedNeonSandboxOwnerFingerprints({
    branchId:NEON_SYNC_SANDBOX_BRANCH,jwt:args.sandboxOwnerJwt,
    fetcher:args.fetcher,
  });
  const first=await read();
  const second=await read();
  if(first.numberOfNotes!==second.numberOfNotes||
     JSON.stringify(first.fingerprints)!==JSON.stringify(second.fingerprints)){
    throw Error("M6 remote inventory changed during uncertain-write reinspection");
  }
  const current=second.fingerprints.find(note=>note.slug===slug);
  return {
    currentRemoteState:!current?"absent-now":
      current.sha256===localHash?"matches-supplied-scratch":"different-now",
    ownerRlsReadOnly:true,transferConfirmed:false,
    baselineSaved:false,automaticRetryAllowed:false,
  };
}
