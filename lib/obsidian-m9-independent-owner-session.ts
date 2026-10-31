/**
 * M9 independent, Owner-only Neon Auth session for the Windows Sync Agent.
 *
 * A user explicitly signs in to a DIFFERENT managed Better Auth session;
 * existing Edge/Chrome HTTP-only cookies are NEVER read or copied.
 * Only the opaque session_token is saved, encrypted using Windows CURRENT
 * USER DPAPI. Plaintext credentials are never logged, stored or exported.
 *
 * Each JWT request checks the real pinned Production Auth GET /get-session,
 * then GET /token with the independent session cookie; it requires verified
 * email, matching JWT subject and blog_admins Owner proof via Neon Data API RLS.
 * A rotated cookie is sealed
 * before the new token is released. No fake "JWT refresh" from decoded data.
 *
 * Neither registration nor refresh starts the automatic Sync Agent.
 * Real mode is MSI Windows ONLY. Test injections are strictly OS TEMP.
 */
import {hostname,homedir,tmpdir} from "node:os";
import {lstat,realpath,readFile,mkdir,readdir,open,rename,unlink} from "node:fs/promises";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {RELEASE_AUTH_URL,RELEASE_ORIGIN,RELEASE_NEON_BRANCH}
  from "./neon/production-release.ts";
import {approvedNeonAdminIdentity} from "./neon/admin-identity.ts";
import {validateProductionOwnerJwt,verifyM7ProductionOwnerReadOnly}
  from "./obsidian-m7-production-owner-readonly.ts";
import {windowsM5KeyProtector} from "./obsidian-m5-owner-baseline-journal.ts";
import type {ProductionM8KeyProtector}
  from "./obsidian-m8-production-baseline-journal.ts";

const SESSION_COOKIE="__Secure-neon-auth.session_token";
const FORMAT="naosledge.m9.independent-owner-session.v1";
const FILE="session.dpapi",LOCK=".m9-session.lock";
const TEST=/^naosledge-m9-session-test-[a-zA-Z0-9_-]{6,}$/;
const COOKIE=/^[a-zA-Z0-9._~%+\-=]{8,4096}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function refuse():never{
  throw Error("M9 independent Owner session unavailable; reauthentication required");
}
type Protector=Pick<ProductionM8KeyProtector,"seal"|"unseal">;
export type M9SessionTestOnly={storageRoot:string;protector:Protector};
async function rootAndProtector(test?:M9SessionTestOnly){
  if(test){
    if(typeof test.storageRoot!=="string"||
       !path.isAbsolute(test.storageRoot)||
       path.dirname(path.resolve(test.storageRoot)).toLowerCase()!==
         path.resolve(tmpdir()).toLowerCase()||
       !TEST.test(path.basename(test.storageRoot))||
       typeof test.protector?.seal!=="function"||
       typeof test.protector?.unseal!=="function")refuse();
    const root=path.resolve(test.storageRoot);
    await safeDir(root);
    return {root,protector:test.protector};
  }
  if(process.platform!=="win32"||
     hostname().trim().toUpperCase()!=="MSI")refuse();
  const base=process.env.LOCALAPPDATA||
    path.join(homedir(),"AppData","Local");
  await safeDir(base);
  const parent=path.join(base,"Naosledge");
  const root=path.join(parent,"m9-independent-session");
  for(const folder of [parent,root]){
    try{await mkdir(folder,{mode:0o700});}
    catch(e){if((e as NodeJS.ErrnoException).code!=="EEXIST")refuse();}
    await safeDir(folder);
  }
  return {root,protector:windowsM5KeyProtector};
}
async function safeDir(dir:string){
  const st=await lstat(dir);
  if(!st.isDirectory()||st.isSymbolicLink()||
     path.resolve(await realpath(dir)).toLowerCase()!==
       path.resolve(dir).toLowerCase())refuse();
}
async function withLock<T>(root:string,action:()=>Promise<T>):Promise<T>{
  const file=path.join(root,LOCK);
  let h:Awaited<ReturnType<typeof open>>;
  try{h=await open(file,"wx",0o600);}catch{refuse();}
  const stat=await h.stat();
  try{
    await h.writeFile("m9-independent-owner-session-single-user");
    await h.sync();
    return await action();
  }finally{
    await h.close();
    const current=await lstat(file).catch(()=>refuse());
    if(!current.isFile()||current.isSymbolicLink()||
       current.nlink!==1||current.ino!==stat.ino)refuse();
    await unlink(file);
  }
}
async function readSafe(file:string,max=12_000):Promise<Buffer>{
  const st=await lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||
     st.size<2||st.size>max)refuse();
  const bytes=await readFile(file);
  const after=await lstat(file);
  if(after.ino!==st.ino||after.size!==st.size||
     after.mtimeMs!==st.mtimeMs||bytes.length!==st.size)refuse();
  return bytes;
}
type Payload={
  format:typeof FORMAT;
  branch:typeof RELEASE_NEON_BRANCH;
  authUrl:typeof RELEASE_AUTH_URL;
  ownerId:string;
  cookie:string;
};
function isPayload(value:unknown):value is Payload{
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const x=value as Record<string,unknown>;
  return JSON.stringify(Object.keys(x))===JSON.stringify([
    "format","branch","authUrl","ownerId","cookie",
  ])&&x.format===FORMAT&&x.branch===RELEASE_NEON_BRANCH&&
    x.authUrl===RELEASE_AUTH_URL&&typeof x.ownerId==="string"&&
    UUID.test(x.ownerId)&&typeof x.cookie==="string"&&COOKIE.test(x.cookie);
}
function cookieFrom(headers:Headers):string|null{
  const values=typeof headers.getSetCookie==="function"?
    headers.getSetCookie():[headers.get("set-cookie")||""];
  const sessions:string[]=[];
  for(const text of values){
    const token=text.split(";")[0]?.trim();
    if(token?.startsWith(SESSION_COOKIE+"=")){
      const v=token.slice(SESSION_COOKIE.length+1);
      if(!COOKIE.test(v))refuse();
      sessions.push(v);
    }
  }
  if(sessions.length>1||sessions.length===1&&
     sessions[0]!==sessions[sessions.length-1])refuse();
  return sessions[0]??null;
}
function pinned(url:string):string{
  const resolved=new URL(url);
  const production=new URL(RELEASE_AUTH_URL);
  if(resolved.protocol!=="https:"||
     resolved.origin!==production.origin||
     !resolved.pathname.startsWith(production.pathname+"/")||
     resolved.username||resolved.password||resolved.search||resolved.hash){
    refuse();
  }
  return resolved.href;
}
async function smallJson(response:Response,max=12_000):Promise<unknown>{
  if(!/^application\/json(?:\s*;|$)/i.test(
    response.headers.get("content-type")||""))refuse();
  const length=response.headers.get("content-length");
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>max))refuse();
  if(!response.body)refuse();
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let count=0;
  try{
    while(true){
      const next=await reader.read();
      if(next.done)break;
      count+=next.value.byteLength;
      if(count>max){await reader.cancel();refuse();}
      parts.push(next.value);
    }
  }catch{refuse();}
  finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true})
    .decode(Buffer.concat(parts))) as unknown;}
  catch{refuse();}
}
async function sessionJwt(cookie:string,fetcher:typeof fetch):Promise<{
  token:string;ownerId:string;cookie:string;
}>{
  const url=pinned(RELEASE_AUTH_URL+"/get-session");
  let response:Response;
  try{response=await fetcher(url,{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{Cookie:SESSION_COOKIE+"="+cookie,
      Origin:RELEASE_ORIGIN,Accept:"application/json",
      "Cache-Control":"no-store"},
    signal:AbortSignal.timeout(15_000),
  });}catch{refuse();}
  if(response.status!==200)refuse();
  const data=await smallJson(response);
  if(!data||typeof data!=="object"||Array.isArray(data))refuse();
  const session=(data as {user?:unknown}).user;
  if(!session||typeof session!=="object"||Array.isArray(session)||
     !approvedNeonAdminIdentity(session as {
       id?:unknown;email?:unknown;emailVerified?:unknown;
     },{} as NodeJS.ProcessEnv))refuse();
  const id=(session as {id:string}).id;
  if(!UUID.test(id))refuse();
  // Neon Auth's documented JWT endpoint is /token. Do not assume the
  // optional set-auth-jwt response header was emitted by /get-session.
  // Use a freshly rotated session cookie immediately, if Auth supplied one.
  const currentCookie=cookieFrom(response.headers)??cookie;
  let tokenResponse:Response;
  try{tokenResponse=await fetcher(pinned(RELEASE_AUTH_URL+"/token"),{
    method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{Cookie:SESSION_COOKIE+"="+currentCookie,
      Origin:RELEASE_ORIGIN,Accept:"application/json",
      "Cache-Control":"no-store"},
    signal:AbortSignal.timeout(15_000),
  });}catch{refuse();}
  if(tokenResponse.status!==200)refuse();
  const dataToken=await smallJson(tokenResponse);
  if(!dataToken||typeof dataToken!=="object"||Array.isArray(dataToken))refuse();
  const token=(dataToken as {token?:unknown}).token;
  const subject=validateProductionOwnerJwt(token);
  if(id!==subject)refuse();
  const owner=await verifyM7ProductionOwnerReadOnly({
    productionOwnerJwt:token as string,fetcher,
  });
  if(!owner.ownerRlsGrantVerified)refuse();
  return {token:token as string,ownerId:id,
    cookie:cookieFrom(tokenResponse.headers)??currentCookie};
}
async function sealedPayload(
  root:string,protector:Protector,
):Promise<Payload>{
  const encrypted=await readSafe(path.join(root,FILE));
  let envelope:unknown;
  try{envelope=JSON.parse(encrypted.toString("utf8"));}
  catch{refuse();}
  if(!envelope||typeof envelope!=="object"||Array.isArray(envelope))refuse();
  const wrapper=envelope as {format?:unknown;branch?:unknown;sealed?:unknown};
  if(JSON.stringify(Object.keys(wrapper))!==JSON.stringify([
    "format","branch","sealed",
  ])||wrapper.format!==FORMAT||wrapper.branch!==RELEASE_NEON_BRANCH||
     typeof wrapper.sealed!=="string"||
     !/^[A-Za-z0-9+/=]{20,10000}$/.test(wrapper.sealed))refuse();
  let unsealed:Buffer;
  try{unsealed=await protector.unseal(wrapper.sealed);}
  catch{refuse();}
  try{
    const decoded=JSON.parse(unsealed.toString("utf8")) as unknown;
    if(!isPayload(decoded))refuse();
    return decoded;
  }finally{unsealed.fill(0);}
}
async function store(root:string,protector:Protector,
  data:Payload,replace:boolean):Promise<void>{
  if(!isPayload(data))refuse();
  const raw=Buffer.from(JSON.stringify(data),"utf8");
  let wrapped:string;
  try{wrapped=await protector.seal(raw);}
  catch{refuse();}
  finally{raw.fill(0);}
  if(!/^[A-Za-z0-9+/=]{20,10000}$/.test(wrapped))refuse();
  const bytes=Buffer.from(JSON.stringify({
    format:FORMAT,branch:RELEASE_NEON_BRANCH,sealed:wrapped,
  }),"utf8");
  const dest=path.join(root,FILE);
  const tmp=path.join(root,".session-"+randomBytes(8).toString("hex")+".tmp");
  const name=replace?tmp:dest;
  let h:Awaited<ReturnType<typeof open>>;
  try{h=await open(name,"wx",0o600);}catch{refuse();}
  try{await h.writeFile(bytes);await h.sync();}
  finally{await h.close();}
  if(!(await readSafe(name)).equals(bytes))refuse();
  if(replace){
    // Atomic same-volume rename only AFTER the protected new payload exists.
    await rename(tmp,dest);
  }
}

export function createM9IndependentProductionOwnerSession(args?:{
  fetcher?:typeof fetch;testOnly?:M9SessionTestOnly;
}){
  const fetcher=args?.fetcher??fetch;
  const testOnly=args?.testOnly;
  return {
    async enrollEmail(args:{
      email:string;password:string;typedConfirmation:string;
    }):Promise<{enrolled:true;ownerRlsVerified:true;credentialsLogged:false}>{
      if(!args||args.typedConfirmation!==
           "ENROLL M9 INDEPENDENT PRODUCTION SESSION"||
         typeof args.email!=="string"||args.email.length>254||
         !/^[^\s@]+@[^\s@]+$/.test(args.email)||
         typeof args.password!=="string"||args.password.length<1||
         args.password.length>1024)refuse();
      const dep=await rootAndProtector(testOnly);
      return withLock(dep.root,async()=>{
        if((await readdir(dep.root)).some(x=>x!==LOCK))refuse();
        let response:Response;
        try{response=await fetcher(pinned(RELEASE_AUTH_URL+"/sign-in/email"),{
          method:"POST",redirect:"manual",credentials:"omit",cache:"no-store",
          headers:{"Content-Type":"application/json",
            Origin:RELEASE_ORIGIN,Accept:"application/json"},
          body:JSON.stringify({email:args.email,password:args.password}),
          signal:AbortSignal.timeout(15_000),
        });}catch{refuse();}
        if(response.status!==200)refuse();
        const cookie=cookieFrom(response.headers);
        if(!cookie)refuse();
        const current=await sessionJwt(cookie,fetcher);
        await store(dep.root,dep.protector,{
          format:FORMAT,branch:RELEASE_NEON_BRANCH,
          authUrl:RELEASE_AUTH_URL,ownerId:current.ownerId,
          cookie:current.cookie,
        },false);
        return {enrolled:true,ownerRlsVerified:true,credentialsLogged:false};
      });
    },
    async requestFreshJwt():Promise<string>{
      const dep=await rootAndProtector(testOnly);
      return withLock(dep.root,async()=>{
        if((await readdir(dep.root)).some(x=>![LOCK,FILE].includes(x)))refuse();
        const stored=await sealedPayload(dep.root,dep.protector);
        const fresh=await sessionJwt(stored.cookie,fetcher);
        if(fresh.ownerId!==stored.ownerId)refuse();
        if(fresh.cookie!==stored.cookie){
          await store(dep.root,dep.protector,
            {...stored,cookie:fresh.cookie},true);
          const readback=await sealedPayload(dep.root,dep.protector);
          if(readback.cookie!==fresh.cookie||
             readback.ownerId!==stored.ownerId)refuse();
        }
        return fresh.token;
      });
    },
  };
}
