/**
 * Authenticated, READ-ONLY remote metadata snapshot FOR NEON SANDBOX ONLY.
 *
 * No production endpoint, no token persistence, no write APIs, no arbitrary
 * URL input, no session cookies and no response-body logging. The caller is
 * responsible for obtaining a short-lived synthetic OWNER JWT through an
 * approved sandbox-only Auth flow. Do not use production credentials.
 *
 * Query still passes through Neon Data API authenticated-role RLS. This code
 * never uses project SQL-owner/admin access or a service-role secret.
 */
import {createHash} from "node:crypto";
import {serializeObsidianMarkdown} from "./obsidian-markdown.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";

export const NEON_SYNC_SANDBOX_BRANCH="br-quiet-sunset-b4xx4pnx";
export const NEON_SYNC_SANDBOX_DATA_API=
  "https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";

const LIMIT=20;
const MAX_RESPONSE_BYTES=5_000_000;
const MAX_NOTE_BYTES=250_000;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type RemoteSandboxSnapshot={
  fingerprints:SyncFingerprint[];
  numberOfNotes:number;
  sandboxOnly:true;
  rlsEnforcedByDataApi:true;
  writeEnabled:false;
  fullInventory:true;
};

type Fetcher=typeof fetch;

function invalid():never{throw new Error("Neon Sandbox returned malformed note metadata");}

function validateRow(value:unknown):{
  slug:string; title:string; summary:string; content_md:string;
  category:string;tags:string[];learned_on:string;updated_at:string;id:string;
}{
  if(!value||typeof value!=="object"||Array.isArray(value))invalid();
  const r=value as Record<string,unknown>;
  if(typeof r.slug!=="string"||r.slug.length<3||r.slug.length>120||!SLUG.test(r.slug)||
    typeof r.title!=="string"||!r.title.trim()||r.title.length>160||
    typeof r.summary!=="string"||r.summary.length>400||
    typeof r.category!=="string"||!r.category.trim()||r.category.length>36||
    typeof r.content_md!=="string"||r.content_md.length>200000||
    !Array.isArray(r.tags)||r.tags.length>12||r.tags.some(
      x=>typeof x!=="string"||x.length>28
    )||
    typeof r.learned_on!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(r.learned_on)||
    typeof r.updated_at!=="string"||r.updated_at.length>50||
    !Number.isFinite(Date.parse(r.updated_at))||
    typeof r.id!=="string"||!UUID.test(r.id))invalid();
  return r as ReturnType<typeof validateRow>;
}

async function limitedResponseText(response:Response):Promise<string>{
  const announced=response.headers.get("content-length");
  if(announced!==null&&(Number(announced)>MAX_RESPONSE_BYTES||!Number.isFinite(Number(announced)))){
    throw new Error("Neon Sandbox response exceeds read-only inventory limit");
  }
  if(!response.body)throw new Error("Neon Sandbox response body unavailable");
  const reader=response.body.getReader();
  const parts:Uint8Array[]=[];
  let size=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>MAX_RESPONSE_BYTES){
        await reader.cancel();
        throw new Error("Neon Sandbox response exceeds read-only inventory limit");
      }
      parts.push(part.value);
    }
  }finally{
    reader.releaseLock();
  }
  return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts));
}

/**
 * The note-list GET alone cannot prove the JWT belongs to an Owner: RLS
 * could legitimately return 200 + [] for a non-owner. Verify the same JWT
 * can SELECT its own blog_admins row before treating a live scan as an
 * Owner-scoped acceptance. This is still GET-only on the pinned Sandbox.
 */
export async function verifyNeonSandboxOwnerRls(args:{
  branchId:string;
  jwt:string;
  fetcher?:Fetcher;
}):Promise<void>{
  if(!args||args.branchId!==NEON_SYNC_SANDBOX_BRANCH||
     typeof args.jwt!=="string"||args.jwt.length>8192||!JWT.test(args.jwt)){
    throw new Error("Approved Sandbox Owner JWT is required");
  }
  let subject:unknown;
  try{
    const data=JSON.parse(Buffer.from(args.jwt.split(".")[1],"base64url").toString("utf8")) as unknown;
    subject=data!==null&&typeof data==="object"&&!Array.isArray(data)?
      (data as Record<string,unknown>).sub:undefined;
  }catch{
    throw new Error("Sandbox JWT subject unavailable");
  }
  if(typeof subject!=="string"||subject.length<10||subject.length>256||
     !/^[A-Za-z0-9_-]+$/.test(subject)){
    throw new Error("Sandbox JWT subject unavailable");
  }
  const endpoint=new URL(NEON_SYNC_SANDBOX_DATA_API);
  if(endpoint.protocol!=="https:"||endpoint.hostname!==
     "ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech"||
     endpoint.pathname!=="/neondb/rest/v1"){
    throw new Error("Sandbox Owner RLS endpoint is not pinned");
  }
  const url=new URL(endpoint.href.replace(/\/$/,"")+"/blog_admins");
  url.searchParams.set("select","user_id");
  url.searchParams.set("user_id","eq."+subject);
  url.searchParams.set("limit","2");
  const response=await (args.fetcher??fetch)(url.href,{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{Authorization:"Bearer "+args.jwt,Accept:"application/json",
      "Cache-Control":"no-store"},
    signal:AbortSignal.timeout(16000),
  });
  if(response.status!==200||
     !/application\/json/i.test(response.headers.get("content-type")||"")){
    throw new Error("Sandbox Owner RLS proof was not accepted");
  }
  let rows:unknown;
  try{
    const raw=await limitedResponseText(response);
    if(raw.length>8192)throw new Error("Oversized grant result");
    rows=JSON.parse(raw) as unknown;
  }catch{throw new Error("Sandbox Owner RLS proof unavailable");}
  if(!Array.isArray(rows)||rows.length!==1||
     !rows[0]||typeof rows[0]!=="object"||Array.isArray(rows[0])||
     Object.keys(rows[0]).length!==1||
     (rows[0] as Record<string,unknown>).user_id!==subject){
    throw new Error("Sandbox JWT lacks the Owner RLS grant");
  }
}

export async function fetchNeonSandboxFingerprints(args:{
  branchId:string;
  jwt:string;
  fetcher?:Fetcher;
}):Promise<RemoteSandboxSnapshot>{
  if(!args||args.branchId!==NEON_SYNC_SANDBOX_BRANCH){
    throw new Error("Only the explicitly approved Neon integration Sandbox is permitted");
  }
  if(typeof args.jwt!=="string"||args.jwt.length>8192||!JWT.test(args.jwt)){
    throw new Error("A valid synthetic sandbox JWT is required");
  }
  // A fixed production-unrelated hostname: callers can neither change the
  // base URL nor force this JWT onto another provider via redirects.
  const endpoint=new URL(NEON_SYNC_SANDBOX_DATA_API);
  if(endpoint.protocol!=="https:"||endpoint.hostname!==
     "ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech"||
     endpoint.pathname!=="/neondb/rest/v1"){
    throw new Error("The approved Neon Sandbox URL is not configured correctly");
  }
  const query=new URL(endpoint.href.replace(/\/$/,"")+"/knowledge_notes");
  query.searchParams.set("select","id,slug,title,summary,content_md,category,tags,learned_on,updated_at");
  query.searchParams.set("order","updated_at.desc");
  query.searchParams.set("limit",String(LIMIT+1));

  const fetcher=args.fetcher??fetch;
  const response=await fetcher(query.href,{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{
      Authorization:"Bearer "+args.jwt,Accept:"application/json",
      "Cache-Control":"no-store",
      // A row limit alone cannot prove the server returned a COMPLETE RLS
      // inventory: PostgREST can impose a smaller server-side max_rows.
      Prefer:"count=exact",
    },
    signal:AbortSignal.timeout(16000),
  });
  // No error body or URL echoed, because it could include private details.
  if(response.status===401||response.status===403){
    throw new Error("Neon Sandbox JWT is unauthenticated or not an authorized Vault owner");
  }
  if(response.status!==200)throw new Error("Neon Sandbox note inventory unavailable");
  if(!/application\/json/i.test(response.headers.get("content-type")||"")){
    throw new Error("Neon Sandbox inventory did not return JSON");
  }

  let payload:unknown;
  try{payload=JSON.parse(await limitedResponseText(response)) as unknown;}
  catch(error){
    if(error instanceof Error&&error.message.includes("read-only inventory limit"))throw error;
    throw new Error("Neon Sandbox returned unparseable inventory");
  }
  if(!Array.isArray(payload)||payload.length>LIMIT){
    throw new Error("Neon Sandbox inventory is too large or invalid; no partial sync allowed");
  }
  // Verify the server-reported exact RLS-visible total AND returned range.
  // Reject absent/unknown totals or silently clamped pages: even a 200 + []
  // is not a verified empty library without */0 from PostgREST.
  const expectedRange=payload.length===0?"*/0":
    `0-${payload.length-1}/${payload.length}`;
  if(response.headers.get("content-range")?.trim()!==expectedRange){
    throw new Error("Neon Sandbox inventory range incomplete or unverified");
  }
  const seen=new Set<string>();
  const fingerprints:SyncFingerprint[]=[];
  for(const row of payload){
    const n=validateRow(row);
    if(seen.has(n.slug))invalid();
    seen.add(n.slug);
    // Hash the EXACT portable .md representation used by the Vault's manual
    // Obsidian exporter. Never send the Markdown body into logs or results.
    const markdown=serializeObsidianMarkdown({
      title:n.title,slug:n.slug,excerpt:n.summary,
      category:n.category,tags:n.tags,learned_on:n.learned_on,
      content_md:n.content_md,
    });
    const bytes=Buffer.from(markdown,"utf8");
    if(bytes.length>MAX_NOTE_BYTES)invalid();
    fingerprints.push({
      slug:n.slug,
      sha256:createHash("sha256").update(bytes).digest("hex"),
      revision:createHash("sha256").update(n.id+":"+n.updated_at).digest("hex"),
    });
  }
  fingerprints.sort((a,b)=>a.slug<b.slug?-1:a.slug>b.slug?1:0);
  return {fingerprints,numberOfNotes:fingerprints.length,
    sandboxOnly:true,rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true};
}

/**
 * Single read-only Owner-scoped entry point for MSI acceptance and future
 * approved adapters. A 200 + [] inventory alone cannot establish ownership:
 * the same Sandbox-only JWT must first pass the independent blog_admins RLS
 * self-grant check. Both requests remain GET-only and pinned to the Sandbox.
 */
export async function fetchVerifiedNeonSandboxOwnerFingerprints(args:{
  branchId:string;
  jwt:string;
  fetcher?:Fetcher;
}):Promise<RemoteSandboxSnapshot>{
  await verifyNeonSandboxOwnerRls(args);
  return fetchNeonSandboxFingerprints(args);
}
