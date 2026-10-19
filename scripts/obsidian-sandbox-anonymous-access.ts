/**
 * Manually invoked real-Neon, SANDBOX-ONLY anonymous Vault isolation smoke.
 *
 * No account signup, cookies, shared secrets, user notes, write methods,
 * production URLs, arbitrary endpoints, or CI schedule. The anonymous JWT
 * remains in process RAM; only response statuses are reported.
 */
import {NEON_SYNC_SANDBOX_DATA_API,NEON_SYNC_SANDBOX_BRANCH} from "../lib/obsidian-neon-sandbox-readonly.ts";

const SANDBOX_AUTH=
  "https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const jwt=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const guardedTables=[
  "knowledge_notes","knowledge_links","knowledge_publication_sources",
] as const;
type Fetcher=typeof fetch;

export async function verifySandboxAnonymousIsolation(args:{
  branchId:string;
  fetcher?:Fetcher;
}):Promise<{branchId:string;tablesChecked:number;allDenied:true;writeMethodsUsed:false}>{
  if(!args||args.branchId!==NEON_SYNC_SANDBOX_BRANCH){
    throw new Error("Anonymous check only accepts approved Neon Sandbox branch");
  }
  const auth=new URL(SANDBOX_AUTH),data=new URL(NEON_SYNC_SANDBOX_DATA_API);
  if(auth.hostname!=="ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech"||
     data.hostname!=="ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech"||
     auth.protocol!=="https:"||data.protocol!=="https:"){
    throw new Error("Sandbox endpoint guard failed");
  }
  const fetcher=args.fetcher??fetch;
  const response=await fetcher(auth.href.replace(/\/$/,"")+"/token/anonymous",{
    method:"GET",
    headers:{Origin:"http://localhost:3000",Accept:"application/json"},
    redirect:"manual",credentials:"omit",
    signal:AbortSignal.timeout(15_000),
  });
  if(response.status!==200||!/application\/json/i.test(response.headers.get("content-type")||"")){
    throw new Error("Neon Sandbox anonymous JWT unavailable");
  }
  const declared=response.headers.get("content-length");
  if(declared!==null&&(!Number.isFinite(Number(declared))||Number(declared)>8192)){
    throw new Error("Anonymous JWT payload size invalid");
  }
  let payload:unknown;
  try{
    const text=await response.text();
    if(text.length>8192)throw Error("too long");
    payload=JSON.parse(text);
  }catch{
    throw new Error("Anonymous JWT response invalid");
  }
  const token=(payload&&typeof payload==="object"&&!Array.isArray(payload))?
    (payload as Record<string,unknown>).token:null;
  if(typeof token!=="string"||token.length>8192||!jwt.test(token)){
    throw new Error("Neon Sandbox anonymous JWT missing");
  }

  for(const table of guardedTables){
    const url=new URL(data.href.replace(/\/$/,"")+"/"+table);
    url.searchParams.set("select","*");
    url.searchParams.set("limit","1");
    const r=await fetcher(url.href,{
      method:"GET",redirect:"manual",credentials:"omit",
      headers:{Authorization:"Bearer "+token,Accept:"application/json"},
      signal:AbortSignal.timeout(15_000),
    });
    // Failed authentication, a forbidden table, or hidden table is safe.
    // HTTP 200 (even []) indicates anonymous visibility, fail closed.
    if(![401,403,404].includes(r.status)){
      throw new Error("Anonymous access policy unsafe for protected table "+table+
        " (HTTP "+r.status+")");
    }
  }
  return {branchId:NEON_SYNC_SANDBOX_BRANCH,
    tablesChecked:guardedTables.length,allDenied:true,writeMethodsUsed:false};
}

const main=process.argv[1]&&process.argv[1].endsWith("obsidian-sandbox-anonymous-access.ts");
if(main){
  try{
    const result=await verifySandboxAnonymousIsolation({branchId:NEON_SYNC_SANDBOX_BRANCH});
    console.log("NEON_SANDBOX_ANONYMOUS_RLS_PASS "+JSON.stringify(result));
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    console.error("NEON_SANDBOX_ANONYMOUS_RLS_FAIL "+message.slice(0,160));
    process.exitCode=1;
  }
}
