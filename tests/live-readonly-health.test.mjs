import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIMARY,LEGACY,PRIVATE_PREVIEW,LIVE_CHECKS,
  checkOneAnonymousRoute,runAnonymousHealth,verifyAnonymousResponse,
} from "../scripts/live-readonly-health.mjs";

function makeResponse(check,{status=check.status,headers={},body}={}){
  const base={};
  if(check.kind==="private"){
    Object.assign(base,{"location":"/login","cache-control":"private, no-store, max-age=0",
      "x-robots-tag":"noindex, nofollow, noarchive"});
  }else if(check.kind==="login"){
    Object.assign(base,{"cache-control":"private, no-store",
      "x-robots-tag":"noindex, nofollow"});
  }else if(check.kind==="legacy"){
    Object.assign(base,{"location":check.location,"x-robots-tag":"noindex"});
  }else if(check.kind==="sso"){
    Object.assign(base,{"location":"https://vercel.com/sso-api?url="+
      encodeURIComponent(check.url)+"&nonce=synthetic","x-robots-tag":"noindex"});
  }
  let text=body;
  if(text===undefined){
    if(check.kind==="home")text='<html><head><link rel="canonical" href="'+PRIMARY+'"/></head><body>Naosledge</body></html>';
    else if(check.kind==="robots")text='User-agent: *\nDisallow: /vault\nDisallow: /studio\nSitemap: '+PRIMARY+'/sitemap.xml';
    else if(check.kind==="sitemap")text='<urlset><url><loc>'+PRIMARY+'/</loc></url></urlset>';
    else text='';
  }
  return new Response(text,{status,headers:{...base,...headers}});
}

test("anonymous monitor defines explicit 14 fixed URL and expectation pairs",()=>{
  assert.equal(LIVE_CHECKS.length,14);
  const names=new Set(LIVE_CHECKS.map(x=>x.name));
  assert.equal(names.size,14);
  assert.equal(LIVE_CHECKS[0].url,PRIMARY+"/");
  assert.ok(LIVE_CHECKS.find(x=>x.url===LEGACY+"/"&&x.status===308));
  assert.ok(LIVE_CHECKS.find(x=>x.url===PRIVATE_PREVIEW+"/login"&&x.status===302));
  assert.ok(LIVE_CHECKS.every(x=>x.url.startsWith(PRIMARY)||
    x.url.startsWith(LEGACY)||x.url.startsWith(PRIVATE_PREVIEW)));
});

test("all official synthetic healthy anonymous endpoints pass offline",async()=>{
  for(const c of LIVE_CHECKS){
    assert.deepEqual(await verifyAnonymousResponse(c,makeResponse(c)),
      {name:c.name,status:c.status},c.name);
  }
});

test("actual fetch uses anonymous GET with manual redirects and no credentials",async()=>{
  const home=LIVE_CHECKS[0];
  let called=0;
  const result=await checkOneAnonymousRoute(home,async(url,opts)=>{
    called++;
    assert.equal(url,PRIMARY+"/");
    assert.equal(opts.method,"GET");
    assert.equal(opts.redirect,"manual");
    assert.equal(opts.credentials,"omit");
    assert.ok(opts.signal instanceof AbortSignal);
    assert.equal(opts.headers,undefined);
    return makeResponse(home);
  });
  assert.equal(called,1);
  assert.equal(result.status,200);
});

test("canonical noindex or unexpected HTML rejects false-green homepage",async()=>{
  const home=LIVE_CHECKS.find(x=>x.name==="home");
  await assert.rejects(verifyAnonymousResponse(home,makeResponse(home,{
    headers:{"x-robots-tag":"noindex"}})),/not indexable/);
  await assert.rejects(verifyAnonymousResponse(home,makeResponse(home,{
    body:'<html><head><link rel="canonical" href="'+LEGACY+'"/></head></html>',
  })),/canonical homepage/);
});

test("private routes cannot return success, public cache or missing noindex",async()=>{
  const testCase=LIVE_CHECKS.find(x=>x.name==="vault-private");
  await assert.rejects(verifyAnonymousResponse(testCase,makeResponse(testCase,{status:200})),/HTTP 200/);
  await assert.rejects(verifyAnonymousResponse(testCase,makeResponse(testCase,{
    headers:{"cache-control":"public, max-age=0"}})),/missing no-store/);
  await assert.rejects(verifyAnonymousResponse(testCase,makeResponse(testCase,{
    headers:{"cache-control":"public, no-store"}})),/public caching/);
  await assert.rejects(verifyAnonymousResponse(testCase,makeResponse(testCase,{
    headers:{"x-robots-tag":"index, follow"}})),/missing noindex/);
});

test("legacy redirects and private Preview SSO must target exact destinations",async()=>{
  const legacy=LIVE_CHECKS.find(x=>x.name==="legacy-home");
  const preview=LIVE_CHECKS.find(x=>x.name==="protected-private-preview");
  await assert.rejects(verifyAnonymousResponse(legacy,makeResponse(legacy,{
    headers:{"location":"https://attacker.invalid/"}})),/approved target/);
  await assert.rejects(verifyAnonymousResponse(preview,makeResponse(preview,{
    headers:{"location":"https://attacker.invalid/login"}})),/Vercel SSO/);
  await assert.rejects(verifyAnonymousResponse(preview,makeResponse(preview,{
    headers:{"location":"https://vercel.com/sso-api?url=https://other.vercel.app"}})),/Vercel SSO/);
});

test("sitemap private entries and robots missing protections fail",async()=>{
  const sitemap=LIVE_CHECKS.find(x=>x.name==="sitemap");
  const robots=LIVE_CHECKS.find(x=>x.name==="robots");
  await assert.rejects(verifyAnonymousResponse(sitemap,makeResponse(sitemap,{
    body:'<urlset><loc>'+PRIMARY+'/vault</loc></urlset>',
  })),/private route/);
  await assert.rejects(verifyAnonymousResponse(robots,makeResponse(robots,{
    body:'User-agent: *\nAllow: /\nSitemap: '+PRIMARY+'/sitemap.xml',
  })),/private Vault/);
});

test("failure aggregation is status-only and does not print private HTML",async()=>{
  const sample=LIVE_CHECKS.slice(0,3);
  let calls=0;
  const results=await runAnonymousHealth({
    checks:sample,
    fetcher:async(url)=>{
      const c=sample.find(x=>x.url===url);
      calls++;
      if(c.name==="about")return makeResponse(c,{status:503,body:"PRIVATE_FAKE_SERVER_BODY"});
      return makeResponse(c);
    },
  });
  assert.equal(calls,3);
  assert.equal(results.length,3);
  assert.deepEqual(results.map(x=>x.ok),[true,false,true]);
  assert.match(results[1].error,/503/);
  assert.doesNotMatch(JSON.stringify(results),/PRIVATE_FAKE_SERVER_BODY/);
});

test("deny injected targets outside the three fixed HTTPS origins",async()=>{
  let invoked=false;
  const run=(url)=>checkOneAnonymousRoute({name:"injected",url,status:200},async()=>{
    invoked=true;return new Response("hello",{status:200});
  });
  await assert.rejects(run("https://example.com/"),/approved/);
  await assert.rejects(run("http://naosledge.vercel.app/"),/approved/);
  assert.equal(invoked,false);
});
