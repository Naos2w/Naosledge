/**
 * M7 manual Production OWNER-RLS preflight, read-only by construction.
 *
 * Checks only the current Owner's single blog_admins grant and the RLS-visible
 * knowledge_notes COUNT. It never queries private note bodies or slugs.
 * A successful count is NOT a full inventory, M2 review, or transfer approval.
 * Production credentials must never be reused with Sandbox adapters.
 */
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "./neon/production-release.ts";

const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SUBJECT=/^[A-Za-z0-9_-]{10,256}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PINNED_ORIGIN="https://ep-purple-recipe-b43kznn2.apirest.c-6.us-east-2.aws.neon.tech";
const PINNED_PATH="/neondb/rest/v1";

type Fetcher=typeof fetch;
export type M7ProductionOwnerReadiness={
  productionBranchVerified:true;
  ownerRlsGrantVerified:true;
  remoteNoteCount:number;
  remoteFullInventoryRead:false;
  privateNoteBodiesRead:false;
  writeEnabled:false;
  baselineSaved:false;
  manualReviewRequired:true;
};

function ensureProductionEndpoint():string{
  const url=new URL(RELEASE_DATA_API_URL);
  if(RELEASE_NEON_BRANCH!=="br-aged-sound-b43h5r2c"||
     url.origin!==PINNED_ORIGIN||url.pathname!==PINNED_PATH||
     url.username||url.password||url.search||url.hash){
    throw Error("M7 Production endpoint or branch is not pinned");
  }
  return url.href.replace(/\/$/,"");
}
export function validateProductionOwnerJwt(jwt:unknown,nowSeconds=Math.floor(Date.now()/1000)):string{
  if(typeof jwt!=="string"||jwt.length<20||jwt.length>8192||!JWT.test(jwt)){
    throw Error("M7 requires a short-lived Production Owner JWT");
  }
  let payload:unknown;
  try{payload=JSON.parse(Buffer.from(jwt.split(".")[1],"base64url").toString("utf8")) as unknown;}
  catch{throw Error("M7 Production JWT claims invalid");}
  if(!payload||typeof payload!=="object"||Array.isArray(payload)){
    throw Error("M7 Production JWT claims invalid");
  }
  const p=payload as Record<string,unknown>;
  if(typeof p.sub!=="string"||!SUBJECT.test(p.sub)||
     typeof p.exp!=="number"||!Number.isSafeInteger(p.exp)||
     p.exp<=nowSeconds||p.exp>nowSeconds+24*60*60){
    throw Error("M7 Production JWT subject or lifetime invalid");
  }
  // The decoded claims are NOT trusted until the actual Neon signed-JWT RLS
  // request proves precisely this Owner's grant; never log these claims.
  return p.sub;
}
async function limitedJson(response:Response,limit:number):Promise<unknown>{
  const declared=response.headers.get("content-length");
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit)){
    throw Error("M7 RLS response size invalid");
  }
  if(!response.body)throw Error("M7 RLS response missing");
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let bytes=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      bytes+=next.value.byteLength;
      if(bytes>limit){await reader.cancel();throw Error("M7 RLS response too large");}
      parts.push(next.value);
    }
  }finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true})
    .decode(Buffer.concat(parts))) as unknown;}
  catch{throw Error("M7 RLS response invalid JSON");}
}
async function ownerGet(
  url:URL,jwt:string,fetcher:Fetcher,allowPartialCount=false,
):Promise<Response>{
  const response=await fetcher(url.href,{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{Authorization:"Bearer "+jwt,Accept:"application/json",
      "Cache-Control":"no-store",Prefer:"count=exact"},
    signal:AbortSignal.timeout(16000),
  });
  if(!(response.status===200||(allowPartialCount&&response.status===206))||
     !/application\/json/i.test(response.headers.get("content-type")||"")){
    // Never echo URL, token, response body or any private content.
    throw Error("M7 Production Owner RLS read unavailable");
  }
  return response;
}
/** No dynamic URLs, environment variables, cookies, post/patch/delete or token storage. */
export async function verifyM7ProductionOwnerReadOnly(args:{
  productionOwnerJwt:string;
  fetcher?:Fetcher;
}):Promise<M7ProductionOwnerReadiness>{
  const api=ensureProductionEndpoint();
  if(!args||typeof args!=="object")throw Error("M7 Owner request missing");
  const subject=validateProductionOwnerJwt(args.productionOwnerJwt);
  const fetcher=args.fetcher??fetch;

  // A 200 + [] is not evidence of being Owner. Verify exactly one grant first.
  const grant=new URL(api+"/blog_admins");
  grant.searchParams.set("select","user_id");
  grant.searchParams.set("user_id","eq."+subject);
  grant.searchParams.set("limit","2");
  const proof=await limitedJson(await ownerGet(grant,args.productionOwnerJwt,fetcher),8192);
  if(!Array.isArray(proof)||proof.length!==1||
     !proof[0]||typeof proof[0]!=="object"||Array.isArray(proof[0])||
     Object.keys(proof[0]).length!==1||
     (proof[0] as Record<string,unknown>).user_id!==subject){
    throw Error("M7 Production Owner grant was not proven through RLS");
  }

  // Only a COUNT, not a partial collection passed off as a complete library.
  const inventory=new URL(api+"/knowledge_notes");
  inventory.searchParams.set("select","id");
  inventory.searchParams.set("limit","1");
  const response=await ownerGet(inventory,args.productionOwnerJwt,fetcher,true);
  const data=await limitedJson(response,4096);
  if(!Array.isArray(data)||data.length>1)throw Error("M7 note count response invalid");
  const range=response.headers.get("content-range")?.trim();
  let count:number;
  if(range==="*/0"&&data.length===0)count=0;
  else{
    const match=/^0-0\/([1-9][0-9]*)$/.exec(range||"");
    if(!match||data.length!==1||
       !data[0]||typeof data[0]!=="object"||Array.isArray(data[0])||
       Object.keys(data[0]).length!==1||
       typeof (data[0] as Record<string,unknown>).id!=="string"||
       !UUID.test((data[0] as Record<string,unknown>).id as string)){
      throw Error("M7 Production RLS count is incomplete or malformed");
    }
    count=Number(match[1]);
    if(!Number.isSafeInteger(count)||count>1_000_000){
      throw Error("M7 Production RLS count is outside supported bounds");
    }
  }
  return {
    productionBranchVerified:true,ownerRlsGrantVerified:true,
    remoteNoteCount:count,remoteFullInventoryRead:false,
    privateNoteBodiesRead:false,writeEnabled:false,baselineSaved:false,
    manualReviewRequired:true,
  };
}
