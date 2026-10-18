/**
 * A manual, read-only, anonymous production health check.
 *
 * All URL targets are fixed here. No cookies, bearer tokens, credentials,
 * arbitrary origins, private note reads, mutations, AI services or cron.
 *
 * Use GET with redirect:'manual', NOT HEAD: Next.js/Vercel HEAD responses can
 * differ from the actual browser GET redirect behavior.
 */
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

export const PRIMARY="https://naosledge.vercel.app";
export const LEGACY="https://naosledge-naos-tsais-projects.vercel.app";
export const PRIVATE_PREVIEW="https://naosledge-git-feat-vault-preview-20261017-naos-tsais-projects.vercel.app";

export const LIVE_CHECKS=Object.freeze([
  {name:"home",url:PRIMARY+"/",status:200,kind:"home"},
  {name:"about",url:PRIMARY+"/about",status:200},
  {name:"login",url:PRIMARY+"/login",status:200,kind:"login"},
  {name:"studio-private",url:PRIMARY+"/studio",status:307,kind:"private"},
  {name:"vault-private",url:PRIMARY+"/vault",status:307,kind:"private"},
  {name:"graph-private",url:PRIMARY+"/vault/graph",status:307,kind:"private"},
  {name:"sitemap",url:PRIMARY+"/sitemap.xml",status:200,kind:"sitemap"},
  {name:"robots",url:PRIMARY+"/robots.txt",status:200,kind:"robots"},
  {name:"missing-public-article",url:PRIMARY+"/notes/naosledge-monitor-nonexistent-post",status:404},
  {name:"legacy-home",url:LEGACY+"/",status:308,kind:"legacy",location:PRIMARY+"/"},
  {name:"legacy-article-path",url:LEGACY+"/about?from=health",status:308,kind:"legacy",location:PRIMARY+"/about?from=health"},
  {name:"legacy-login",url:LEGACY+"/login",status:308,kind:"legacy",location:PRIMARY+"/login"},
  {name:"legacy-vault",url:LEGACY+"/vault",status:308,kind:"legacy",location:PRIMARY+"/vault"},
  {name:"protected-private-preview",url:PRIVATE_PREVIEW+"/login",status:302,kind:"sso"},
]);

function requireMatch(value,pattern,label){
  if(!pattern.test(value||""))throw new Error(label);
}

/** Verify only public status/headers and limited public HTML, never private bodies. */
export async function verifyAnonymousResponse(check,response){
  if(response.status!==check.status){
    throw new Error(`HTTP ${response.status}; expected ${check.status}`);
  }
  const cache=response.headers.get("cache-control")||"";
  const robots=response.headers.get("x-robots-tag")||"";
  const location=response.headers.get("location")||"";
  if(check.kind==="private"){
    if(location!=="/login")throw new Error("private route did not redirect to /login");
    requireMatch(cache,/\bno-store\b/,"private redirect missing no-store");
    if(/\bpublic\b/.test(cache))throw new Error("private redirect permits public caching");
    requireMatch(robots,/\bnoindex\b/,"private redirect missing noindex");
  }
  if(check.kind==="login"){
    requireMatch(cache,/\bno-store\b/,"login missing no-store");
    requireMatch(robots,/\bnoindex\b/,"login missing noindex");
  }
  if(check.kind==="legacy"&&location!==check.location){
    throw new Error("legacy redirect does not preserve approved target path/query");
  }
  if(check.kind==="sso"){
    let url;
    try{url=new URL(location);}catch{throw new Error("protected Preview has no valid SSO redirect");}
    if(url.origin!=="https://vercel.com"||url.pathname!=="/sso-api"||
      !url.searchParams.get("url")?.startsWith(PRIVATE_PREVIEW+"/")){
      throw new Error("private Preview did not redirect to Vercel SSO");
    }
    requireMatch(robots,/\bnoindex\b/,"SSO preview missing noindex");
  }
  if(check.kind==="home"){
    if(/\bnoindex\b/.test(robots))throw new Error("canonical homepage is not indexable");
    const body=(await response.text()).slice(0,250_000);
    requireMatch(body,/<html[\s>]/i,"homepage is not HTML");
    requireMatch(body,/<link\s+rel="canonical"\s+href="https:\/\/naosledge\.vercel\.app\/?"/i,
      "canonical homepage points to the wrong origin");
  }
  if(check.kind==="robots"){
    const body=(await response.text()).slice(0,50_000);
    requireMatch(body,/Disallow:\s*\/vault\b/i,"robots fails to exclude private Vault");
    requireMatch(body,/Disallow:\s*\/studio\b/i,"robots fails to exclude Studio");
    requireMatch(body,/https:\/\/naosledge\.vercel\.app\/sitemap\.xml/i,
      "robots advertises an incorrect sitemap origin");
  }
  if(check.kind==="sitemap"){
    const body=(await response.text()).slice(0,250_000);
    requireMatch(body,/<urlset\b/i,"sitemap response is not XML urlset");
    requireMatch(body,/https:\/\/naosledge\.vercel\.app/i,
      "sitemap uses an incorrect canonical origin");
    if(/naosledge-naos-tsais-projects|\/vault(?:\/|<)|\/studio(?:\/|<)/i.test(body)){
      throw new Error("sitemap leaks a legacy or private route");
    }
  }
  return {name:check.name,status:response.status};
}

export async function checkOneAnonymousRoute(check,fetcher=fetch){
  // Defensive allowlist: never follow a redirect into SSO or fetch from a
  // user-provided URL. This assertion covers accidental future test changes.
  const url=new URL(check.url);
  if(url.protocol!=="https:"||![new URL(PRIMARY).host,new URL(LEGACY).host,
      new URL(PRIVATE_PREVIEW).host].includes(url.host)){
    throw new Error("not an approved public/preview health-check origin");
  }
  const response=await fetcher(check.url,{
    method:"GET",redirect:"manual",credentials:"omit",
    signal:AbortSignal.timeout(15_000),
  });
  return await verifyAnonymousResponse(check,response);
}

/** Bounded concurrency avoids bursts and keeps Hobby/Neon costs low. */
export async function runAnonymousHealth({fetcher=fetch,checks=LIVE_CHECKS}={}){
  const items=[];
  for(let i=0;i<checks.length;i+=3){
    const group=await Promise.allSettled(checks.slice(i,i+3).map(check=>
      checkOneAnonymousRoute(check,fetcher)));
    group.forEach((r,j)=>{
      const name=checks[i+j].name;
      if(r.status==="fulfilled")items.push({ok:true,...r.value});
      else items.push({ok:false,name,error:String(r.reason?.message||r.reason).slice(0,160)});
    });
  }
  return items;
}

const runningAsMain=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(runningAsMain){
  try{
    const results=await runAnonymousHealth();
    for(const r of results){
      console.log(r.ok?`PASS ${r.name} HTTP ${r.status}`:`FAIL ${r.name}: ${r.error}`);
    }
    const failed=results.filter(r=>!r.ok);
    if(failed.length)process.exitCode=1;
    else console.log(`LIVE_READ_ONLY_HEALTH_OK ${results.length}/${results.length}`);
  }catch(error){
    console.error("LIVE_READ_ONLY_HEALTH_FAILED "+String(error?.message||error).slice(0,160));
    process.exitCode=1;
  }
}
