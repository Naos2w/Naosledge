import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProductionOwnerJwt,verifyM7ProductionOwnerReadOnly,
} from "../lib/obsidian-m7-production-owner-readonly.ts";
import {
  assertM7ReadOnlyInvocation,readM7ProductionOwnerJwt,
  previewM7ProductionOwnerReadiness,
} from "../scripts/obsidian-m7-production-preflight.ts";
import {RELEASE_DATA_API_URL} from "../lib/neon/production-release.ts";
const SUBJECT="00000000-0000-4000-8000-000000000041";
const ID="00000000-0000-4000-8000-000000000042";
const now=Math.floor(Date.now()/1000);
const jwtFor=(claims={})=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub:SUBJECT,exp:now+900,...claims})).toString("base64url")+
  ".syntheticsignature";

function json(data,{status=200,range}={}){
  const headers={"content-type":"application/json"};
  if(range!==undefined)headers["content-range"]=range;
  return new Response(JSON.stringify(data),{status,headers});
}
function makeFetcher({grant=[{user_id:SUBJECT}],notes=[],range="*/0",status=200,check}={}){
  const calls=[];
  const fetcher=async(url,opts)=>{
    const parsed=new URL(url);
    calls.push({url:parsed,opts});
    check?.(parsed,opts,calls.length);
    return parsed.pathname.endsWith("/blog_admins")?
      json(grant):json(notes,{range,status});
  };
  return {fetcher,calls};
}

test("M7 read-only counts strictly use the pinned Production endpoint and two signed-JWT RLS requests",async()=>{
  const token=jwtFor();
  const {fetcher,calls}=makeFetcher();
  const result=await verifyM7ProductionOwnerReadOnly({productionOwnerJwt:token,fetcher});
  assert.equal(calls.length,2);
  for(const {url,opts} of calls){
    assert.equal(url.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.ok(url.pathname==="/neondb/rest/v1/blog_admins"||
      url.pathname==="/neondb/rest/v1/knowledge_notes");
    assert.equal(opts.method,"GET");
    assert.equal(opts.redirect,"manual");
    assert.equal(opts.credentials,"omit");
    assert.equal(opts.cache,"no-store");
    assert.equal(opts.headers.Authorization,"Bearer "+token);
    assert.equal(opts.headers.Prefer,"count=exact");
    assert.equal(opts.headers["Cache-Control"],"no-store");
    assert.equal(opts.body,undefined);
    assert.ok(opts.signal instanceof AbortSignal);
  }
  assert.equal(calls[0].url.searchParams.get("user_id"),"eq."+SUBJECT);
  assert.equal(calls[0].url.searchParams.get("limit"),"2");
  assert.equal(calls[1].url.searchParams.get("select"),"id");
  assert.equal(calls[1].url.searchParams.get("limit"),"1");
  assert.equal(calls[1].url.searchParams.get("slug"),null);
  assert.equal(calls[1].url.searchParams.get("content_md"),null);
  assert.deepEqual(result,{
    productionBranchVerified:true,ownerRlsGrantVerified:true,
    remoteNoteCount:0,remoteFullInventoryRead:false,
    privateNoteBodiesRead:false,writeEnabled:false,baselineSaved:false,
    manualReviewRequired:true,
  });
  assert.doesNotMatch(JSON.stringify(result),/00000000|syntheticsignature/);
});
test("M7 counts RLS-visible notes without pretending one returned row is a complete inventory",async()=>{
  const {fetcher}=makeFetcher({notes:[{id:ID}],range:"0-0/7",status:206});
  const result=await verifyM7ProductionOwnerReadOnly({productionOwnerJwt:jwtFor(),fetcher});
  assert.equal(result.remoteNoteCount,7);
  assert.equal(result.remoteFullInventoryRead,false);
  assert.equal(result.manualReviewRequired,true);
});
test("M7 refuses invalid JWT subjects, past dates, oversized and malformed tokens before any GET",async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;return json([]);};
  for(const token of ["","x.y.z","x.y",jwtFor({sub:"../evil"}),
    jwtFor({exp:now-10}),jwtFor({exp:now+8*86400}),
    jwtFor({sub:4}),"a.".repeat(5000)+"z"]){
    await assert.rejects(verifyM7ProductionOwnerReadOnly({productionOwnerJwt:token,fetcher}),
      /Production JWT|Owner JWT|claims/);
  }
  assert.equal(calls,0);
  assert.equal(validateProductionOwnerJwt(jwtFor(),now),SUBJECT);
});
test("M7 rejects a 200 empty/non-owner Owner-grant response before reading inventory",async()=>{
  for(const grant of [[],[{user_id:ID}],
    [{user_id:SUBJECT,owner_id:SUBJECT}],
    [{user_id:SUBJECT},{user_id:SUBJECT}]]){
    const {fetcher,calls}=makeFetcher({grant});
    await assert.rejects(verifyM7ProductionOwnerReadOnly({productionOwnerJwt:jwtFor(),fetcher}),
      /grant was not proven/);
    assert.equal(calls.length,1);
  }
});
test("M7 rejects auth redirects, no JSON, and 403 without echoing response bodies",async()=>{
  for(const response of [
    new Response("TOP_SECRET_REMOTE_ERROR",{status:403}),
    new Response("",{status:302,headers:{location:"https://attacker.example"}}),
    new Response("<html>TOP_SECRET_REMOTE_ERROR</html>",{status:200,headers:{"content-type":"text/html"}}),
  ]){
    await assert.rejects(
      verifyM7ProductionOwnerReadOnly({productionOwnerJwt:jwtFor(),fetcher:async()=>response}),
      err=>{
        assert.match(err.message,/read unavailable/);
        assert.doesNotMatch(err.message,/TOP_SECRET|attacker/);
        return true;
      }
    );
  }
});
test("M7 requires exact count headers and rejects truncated/partial/ambiguous inventories",async()=>{
  const failures=[
    {notes:[],range:""},
    {notes:[],range:"*/2"},
    {notes:[],range:"0-0/1"},
    {notes:[{id:ID}],range:"0-0/*"},
    {notes:[{id:ID}],range:"0-0/0"},
    {notes:[{id:ID}],range:"1-1/2"},
    {notes:[{id:ID}],range:"0-1/2"},
    {notes:[{id:ID}],range:"0-0/01"},
    {notes:[{id:ID}],range:"0-0/1000001"},
    {notes:[{id:"NOT_A_UUID"}],range:"0-0/2"},
    {notes:[{id:ID,title:"leak"}],range:"0-0/2"},
    {notes:[{id:ID},{id:ID}],range:"0-0/2"},
  ];
  for(const {notes,range} of failures){
    const {fetcher}=makeFetcher({notes,range});
    await assert.rejects(verifyM7ProductionOwnerReadOnly({
      productionOwnerJwt:jwtFor(),fetcher,
    }),/count.*(incomplete|malformed|invalid|outside)|note count response invalid/);
  }
});
test("M7 rejects malicious oversized or truncated malformed RLS JSON",async()=>{
  const token=jwtFor();
  await assert.rejects(verifyM7ProductionOwnerReadOnly({
    productionOwnerJwt:token,
    fetcher:async()=>new Response("TOP_SECRET",{status:200,headers:{
      "content-type":"application/json","content-length":"9000",
    }}),
  }),/size invalid/);
  await assert.rejects(verifyM7ProductionOwnerReadOnly({
    productionOwnerJwt:token,
    fetcher:async()=>new Response('{"private":"TOP_SECRET"',{status:200,headers:{
      "content-type":"application/json",
    }}),
  }),err=>{
    assert.match(err.message,/invalid JSON/);
    assert.doesNotMatch(err.message,/TOP_SECRET/);
    return true;
  });
});
test("M7 explicit manual entry is only allowed on MSI with one read-only flag and private stdin",()=>{
  assert.doesNotThrow(()=>assertM7ReadOnlyInvocation(
    "win32","MSI",["--m7-production-owner-readonly"],false
  ));
  for(const [platform,host,args,tty] of [
    ["linux","MSI",["--m7-production-owner-readonly"],false],
    ["win32","PC2",["--m7-production-owner-readonly"],false],
    ["win32","MSI",[],false],
    ["win32","MSI",["--m7-production-owner-readonly","--write"],false],
    ["win32","MSI",["--sandbox-first-look-readonly"],false],
    ["win32","MSI",["--m7-production-owner-readonly"],true],
  ]){
    assert.throws(()=>assertM7ReadOnlyInvocation(platform,host,args,tty));
  }
});
test("M7 private stdin reader bounds secrets and never handles credentials in argv or environment",async()=>{
  const token=jwtFor();
  async function* one(s){yield s;}
  assert.equal(await readM7ProductionOwnerJwt(one(token+"\n")),token);
  await assert.rejects(readM7ProductionOwnerJwt(one("a.b.c\nBAD")) ,/malformed/);
  await assert.rejects(readM7ProductionOwnerJwt(one("a".repeat(9000))),/too large/);
});
test("M7 combines read-only Production count and registered MSI Vault counts without sync permission",async()=>{
  const token=jwtFor();
  const result=await previewM7ProductionOwnerReadiness({
    productionOwnerJwt:token,
    vaultPath:"C:\\Naos\\Obsidian\\Naosledge",
    registryPath:"C:\\Users\\Example\\AppData\\Roaming\\obsidian\\obsidian.json",
    remoteReader:async()=>({
      productionBranchVerified:true,ownerRlsGrantVerified:true,
      remoteNoteCount:3,remoteFullInventoryRead:false,
      privateNoteBodiesRead:false,writeEnabled:false,
      baselineSaved:false,manualReviewRequired:true,
    }),
    registrationReader:async()=>({
      registered:true,autoSyncEnabled:false,configPresent:true,
      appConfigPresent:true,matchedRegistrations:1,
    }),
    localReader:async()=>({
      fingerprints:[{slug:"my-note",sha256:"a".repeat(64)}],
      unsupportedMarkdownFiles:1,otherFiles:0,directoriesNotScanned:2,
      autoApplyAllowed:false,
    }),
  });
  assert.equal(result.productionRemoteNotes,3);
  assert.equal(result.localSupportedNotes,1);
  assert.equal(result.localUnsupportedMarkdown,1);
  assert.equal(result.localDirectoriesNotScanned,2);
  assert.equal(result.remoteFullInventoryRead,false);
  assert.equal(result.comparisonPerformed,false);
  assert.equal(result.noteBodiesTransferred,false);
  assert.equal(result.perNoteApprovalGranted,false);
  assert.equal(result.localWrites,0);
  assert.equal(result.remoteWrites,0);
  assert.doesNotMatch(JSON.stringify(result),/my-note|syntheticsignature/);
});
test("M7 refuses an unsafe remote reader or an unregistered real Vault",async()=>{
  const shared={
    productionOwnerJwt:jwtFor(),
    remoteReader:async()=>({
      productionBranchVerified:true,ownerRlsGrantVerified:true,
      remoteNoteCount:0,remoteFullInventoryRead:false,
      privateNoteBodiesRead:false,writeEnabled:false,
      baselineSaved:false,manualReviewRequired:true,
    }),
    registrationReader:async()=>({
      registered:false,autoSyncEnabled:false,configPresent:false,
      appConfigPresent:false,matchedRegistrations:0,
    }),
    localReader:async()=>{throw Error("local scan should not start");},
  };
  await assert.rejects(previewM7ProductionOwnerReadiness(shared),/not registered/);
  await assert.rejects(previewM7ProductionOwnerReadiness({
    ...shared,remoteReader:async()=>({
      ...(await shared.remoteReader()),remoteFullInventoryRead:true,
    }),
  }),/unsafe state/);
});
