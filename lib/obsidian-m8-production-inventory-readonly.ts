/**
 * M8: complete, read-only Production Owner-RLS note fingerprint inventory.
 *
 * Reuses the exact M3 portable Markdown SHA and revision convention, but NEVER
 * returns note bodies, JWTs, Owner IDs, or raw rows. Only an authenticated,
 * short-lived production Owner JWT may be supplied by a trusted MSI process.
 *
 * This does not approve pairing, start a watcher, mutate Neon, download into
 * the real Vault, or write an M5 baseline. It is NOT called by public routes.
 */
import {createHash} from "node:crypto";
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "./neon/production-release.ts";
import {validateProductionOwnerJwt} from "./obsidian-m7-production-owner-readonly.ts";
import {serializeObsidianMarkdown} from "./obsidian-markdown.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";
import type {AutoSyncRemoteSnapshot} from "./obsidian-auto-sync-policy.ts";

const ORIGIN="https://ep-purple-recipe-b43kznn2.apirest.c-6.us-east-2.aws.neon.tech";
const PATH="/neondb/rest/v1";
const PAGE_SIZE=20;
const MAX_NOTES=500;
const MAX_PAGE_BYTES=6_000_000;
const MAX_MARKDOWN_BYTES=250_000;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS=[
  "id","slug","title","summary","content_md","category","tags",
  "learned_on","updated_at",
] as const;
const EXPECTED_KEYS=new Set<string>(FIELDS);
type Fetcher=typeof fetch;
type Row={
  id:string;slug:string;title:string;summary:string;content_md:string;
  category:string;tags:string[];learned_on:string;updated_at:string;
};
function refuse():never{
  throw Error("M8 Production Owner-RLS inventory unavailable or inconsistent");
}
function productionRoot():string{
  const url=new URL(RELEASE_DATA_API_URL);
  if(RELEASE_NEON_BRANCH!=="br-aged-sound-b43h5r2c"||
     url.protocol!=="https:"||url.origin!==ORIGIN||
     url.pathname!==PATH||url.username||url.password||url.search||url.hash) {
    throw Error("M8 Production endpoint is not pinned");
  }
  return url.href.replace(/\/$/,"");
}
function checkSignal(signal?:AbortSignal):void{
  if(signal?.aborted)refuse();
}
async function readLimitedJson(response:Response,limit:number):Promise<unknown>{
  const rawLength=response.headers.get("content-length");
  if(rawLength!==null&&(!/^\d+$/.test(rawLength)||Number(rawLength)>limit))refuse();
  if(!response.body)refuse();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];
  let total=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      total+=part.value.byteLength;
      if(total>limit){await reader.cancel();refuse();}
      chunks.push(part.value);
    }
  }catch{refuse();}
  finally{reader.releaseLock();}
  try{
    return JSON.parse(new TextDecoder("utf-8",{fatal:true})
      .decode(Buffer.concat(chunks))) as unknown;
  }catch{refuse();}
}
async function getJson(url:URL,token:string,fetcher:Fetcher,signal?:AbortSignal){
  checkSignal(signal);
  const timeout=AbortSignal.timeout(16_000);
  let response:Response;
  try{
    response=await fetcher(url.href,{
      method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{
        Authorization:"Bearer "+token,Accept:"application/json",
        "Cache-Control":"no-store",Prefer:"count=exact",
      },
      signal:signal?AbortSignal.any([signal,timeout]):timeout,
    });
  }catch{refuse();}
  if(![200,206].includes(response.status)||
     !/^application\/json(?:\s*;|$)/i.test(
       response.headers.get("content-type")||""
     ))refuse();
  return response;
}
function parseRow(raw:unknown):Row{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))refuse();
  const record=raw as Record<string,unknown>;
  if(Object.keys(record).length!==EXPECTED_KEYS.size||
     Object.keys(record).some(key=>!EXPECTED_KEYS.has(key)))refuse();
  if(typeof record.id!=="string"||!UUID.test(record.id)||
     typeof record.slug!=="string"||record.slug.length<3||
     record.slug.length>120||!SLUG.test(record.slug)||
     typeof record.title!=="string"||record.title.length>160||
     !record.title.trim()||
     typeof record.summary!=="string"||record.summary.length>400||
     typeof record.content_md!=="string"||record.content_md.length>200_000||
     typeof record.category!=="string"||!record.category.trim()||
     record.category.length>36||!Array.isArray(record.tags)||
     record.tags.length>12||record.tags.some(x=>typeof x!=="string"||x.length>28)||
     typeof record.learned_on!=="string"||
     !/^\d{4}-\d{2}-\d{2}$/.test(record.learned_on)||
     !Number.isFinite(Date.parse(record.learned_on+"T00:00:00Z"))||
     typeof record.updated_at!=="string"||record.updated_at.length>50||
     !/^\d{4}-\d{2}-\d{2}T/.test(record.updated_at)||
     !Number.isFinite(Date.parse(record.updated_at)))refuse();
  return record as Row;
}
function fingerprint(record:Row):SyncFingerprint{
  const source=serializeObsidianMarkdown({
    title:record.title,slug:record.slug,excerpt:record.summary,
    category:record.category,tags:record.tags,learned_on:record.learned_on,
    content_md:record.content_md,
  });
  const bytes=Buffer.from(source,"utf8");
  if(bytes.length>MAX_MARKDOWN_BYTES)refuse();
  return {
    slug:record.slug,
    sha256:createHash("sha256").update(bytes).digest("hex"),
    // Same identity/revision formula used by the existing M3/M4 Sandbox.
    revision:createHash("sha256").update(record.id+":"+record.updated_at)
      .digest("hex"),
  };
}
function parseRange(
  response:Response,rows:number,offset:number,expectedTotal:number|null,
):number{
  const header=response.headers.get("content-range")?.trim()||"";
  if(offset===0&&rows===0&&header==="*/0"&&expectedTotal===null)return 0;
  const match=/^(\d+)-(\d+)\/(\d+)$/.exec(header);
  if(!match)refuse();
  const start=Number(match[1]),end=Number(match[2]),total=Number(match[3]);
  if(!Number.isSafeInteger(total)||total<1||total>MAX_NOTES||
     (expectedTotal!==null&&total!==expectedTotal)||
     start!==offset||end!==start+rows-1||rows<1||
     rows!==Math.min(PAGE_SIZE,total-offset))refuse();
  return total;
}
async function singlePass(args:{
  base:string;token:string;fetcher:Fetcher;signal?:AbortSignal;
}):Promise<SyncFingerprint[]>{
  const seenIds=new Set<string>(),seenSlugs=new Set<string>();
  const fingerprints:SyncFingerprint[]=[];
  let total:number|null=null,offset=0;
  while(total===null||offset<total){
    checkSignal(args.signal);
    const page=new URL(args.base+"/knowledge_notes");
    page.searchParams.set("select",FIELDS.join(","));
    page.searchParams.set("order","slug.asc,id.asc");
    page.searchParams.set("limit",String(PAGE_SIZE));
    page.searchParams.set("offset",String(offset));
    const response=await getJson(page,args.token,args.fetcher,args.signal);
    const payload=await readLimitedJson(response,MAX_PAGE_BYTES);
    if(!Array.isArray(payload)||payload.length>PAGE_SIZE)refuse();
    const pageTotal=parseRange(response,payload.length,offset,total);
    if(total===null)total=pageTotal;
    if(total===0)return [];
    for(const item of payload){
      const record=parseRow(item);
      if(seenIds.has(record.id)||seenSlugs.has(record.slug))refuse();
      if(fingerprints.length>0&&
         fingerprints[fingerprints.length-1].slug>=record.slug)refuse();
      seenIds.add(record.id);seenSlugs.add(record.slug);
      fingerprints.push(fingerprint(record));
    }
    offset+=payload.length;
    if(offset>MAX_NOTES)refuse();
  }
  if(total===null||fingerprints.length!==total)refuse();
  return fingerprints;
}

/**
 * Only after a signed JWT passes a real Owner self-grant via Neon RLS does
 * this return a complete collection. Large multi-page scans run twice and
 * must yield an identical SHA/revision set to reject offset pagination races.
 * A transfer executor MUST independently recheck before writing.
 */
export async function fetchProductionOwnerRlsFingerprints(args:{
  branchId:string;
  jwt:string;
  fetcher?:Fetcher;
  signal?:AbortSignal;
}):Promise<AutoSyncRemoteSnapshot>{
  if(!args||args.branchId!==RELEASE_NEON_BRANCH)refuse();
  const token=args.jwt;
  const owner=validateProductionOwnerJwt(token);
  const base=productionRoot(),fetcher=args.fetcher??fetch;
  checkSignal(args.signal);
  const self=new URL(base+"/blog_admins");
  self.searchParams.set("select","user_id");
  self.searchParams.set("user_id","eq."+owner);
  self.searchParams.set("limit","2");
  const proof=await getJson(self,token,fetcher,args.signal);
  if(proof.status!==200)refuse();
  const ownerRows=await readLimitedJson(proof,8192);
  if(!Array.isArray(ownerRows)||ownerRows.length!==1||
     !ownerRows[0]||typeof ownerRows[0]!=="object"||
     Array.isArray(ownerRows[0])||
     Object.keys(ownerRows[0]).length!==1||
     (ownerRows[0] as Record<string,unknown>).user_id!==owner)refuse();

  const params={base,token,fetcher,signal:args.signal};
  const first=await singlePass(params);
  if(first.length>PAGE_SIZE){
    const second=await singlePass(params);
    if(JSON.stringify(first)!==JSON.stringify(second))refuse();
  }
  checkSignal(args.signal);
  return {
    branchId:RELEASE_NEON_BRANCH,
    fingerprints:first,numberOfNotes:first.length,
    fullInventory:true,ownerRlsVerified:true,writeEnabled:false,
  };
}
