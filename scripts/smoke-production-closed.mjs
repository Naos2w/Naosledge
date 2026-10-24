/**
 * Offline HTTP verification of an UNAPPROVED Vercel Production deployment.
 * Starts the already-built Next.js server with synthetic Vercel metadata,
 * no Neon/Supabase credentials and no network calls to external services.
 */
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
async function availablePort(){
  return await new Promise((resolve,reject)=>{
    const s=createServer();
    s.once("error",reject);
    s.listen(0,"127.0.0.1",()=>{
      const address=s.address();
      s.close(()=>resolve(address.port));
    });
  });
}
const port=await availablePort();
const origin=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,[
  path.join(root,"node_modules","next","dist","bin","next"),
  "start","--hostname","127.0.0.1","--port",String(port),
],{
  cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"],
  env:{
    ...process.env,
    NODE_ENV:"production",
    VERCEL:"1",VERCEL_ENV:"production",
    VERCEL_PROJECT_ID:"prj_JEXZkiab0njUM7VWFhDO0NhL0GtH",
    VERCEL_GIT_COMMIT_REF:"main",
    VERCEL_GIT_COMMIT_SHA:"a".repeat(40),
    NAOSLEDGE_PRODUCTION_ENABLED:"0", // Explicitly NOT authorized.
    NAOSLEDGE_PRODUCTION_RELEASE_SHA:"b".repeat(40),
    NAOSLEDGE_BACKEND:"supabase",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"supabase",
    NEON_AUTH_BASE_URL:"",NEON_DATA_API_URL:"",
    NEON_AUTH_COOKIE_SECRET:"",
    NEXT_PUBLIC_SUPABASE_URL:"",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"",
    NEXT_PUBLIC_SITE_URL:"",
  },
});
let logs="";
for(const stream of [child.stdout,child.stderr])stream.on("data",data=>{
  logs=(logs+data.toString()).slice(-1600);
});
try{
  let up=false;
  for(let n=0;n<65;n++){
    if(child.exitCode!==null)throw Error("Next exited with "+child.exitCode);
    try{
      const response=await fetch(origin+"/",{
        redirect:"manual",signal:AbortSignal.timeout(1200),
      });
      if(response.status===503){up=true;break;}
      // Any public response proves an accidental release.
      throw Error("Unapproved production returned HTTP "+response.status);
    }catch(error){
      if(error?.message?.includes("Unapproved production"))throw error;
    }
    await delay(400);
  }
  if(!up)throw Error("Fail-closed production startup timed out");
  for(const pathname of [
    "/","/login","/studio","/vault","/vault/graph","/vault/sync",
    "/notes/synthetic-post","/robots.txt","/sitemap.xml",
    "/forgot-password","/owner-activation",
  ]){
    const response=await fetch(origin+pathname,{
      redirect:"manual",signal:AbortSignal.timeout(2500),
    });
    assert.equal(response.status,503,"Denied production request: "+pathname);
    assert.match(response.headers.get("cache-control")||"",/no-store/);
    assert.match(response.headers.get("x-robots-tag")||"",/noindex/);
    assert.equal(response.headers.get("referrer-policy"),"no-referrer");
  }
  console.log("PASS: 11 public/private/auth/SEO routes return HTTP 503, no-store and noindex");
  console.log("PRODUCTION_RELEASE_GATE_CLOSED_SUCCESS: no live database credentials or calls");
}catch(error){
  throw Error(String(error?.message||error)+"; diagnostic="+logs.replace(/[^\x20-\x7e]/g," ").slice(-800));
}finally{
  child.kill();
}
