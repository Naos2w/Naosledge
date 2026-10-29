import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {fetchProductionOwnerRlsFingerprints} from "../lib/obsidian-m8-production-inventory-readonly.ts";
import {RELEASE_NEON_BRANCH,RELEASE_DATA_API_URL} from "../lib/neon/production-release.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const subjectJwt=(claim={})=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({
    sub:SUB,exp:Math.floor(Date.now()/1000)+3600,...claim,
  })).toString("base64url")+".syntheticsignature";
const record=(i,opts={})=>{
  const slug="note-"+String(i).padStart(3,"0");
  return {
    id:"00000000-0000-4000-8000-"+String(i).padStart(12,"0"),
    slug,title:"Synthetic "+i,summary:"only test notes",content_md:"# synthetic "+i,
    category:"test",tags:["m8"],learned_on:"2026-10-29",
    updated_at:"2026-10-29T03:00:00.000Z",...opts,
  };
};
const rows=n=>Array.from({length:n},(_,i)=>record(i+1));
function respond(value,range,code=200,headers={}){
  return new Response(JSON.stringify(value),{status:code,headers:{
    "content-type":"application/json",...(range?{"content-range":range}:{}),...headers,
  }});
}
function fakeOwner(rowsByScan,opts={}){
  const calls=[];
  let scan=-1;
  const fetcher=async(uri,config)=>{
    const u=new URL(uri);
    calls.push({url:u,config});
    assert.equal(u.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(u.pathname.startsWith("/neondb/rest/v1/"),true);
    assert.equal(config.method,"GET");
    assert.equal(config.redirect,"manual");
    assert.equal(config.credentials,"omit");
    assert.equal(config.cache,"no-store");
    assert.equal(config.headers.Prefer,"count=exact");
    assert.match(config.headers.Authorization,/^Bearer /);
    assert.equal(config.body,undefined);
    if(u.pathname.endsWith("/blog_admins")){
      assert.equal(u.searchParams.get("select"),"user_id");
      assert.equal(u.searchParams.get("user_id"),"eq."+SUB);
      assert.equal(u.searchParams.get("limit"),"2");
      return respond(opts.grant??[{user_id:SUB}],"0-0/1");
    }
    assert.ok(u.pathname.endsWith("/knowledge_notes"));
    assert.equal(u.searchParams.get("select"),
      "id,slug,title,summary,content_md,category,tags,learned_on,updated_at");
    assert.equal(u.searchParams.get("order"),"slug.asc,id.asc");
    assert.equal(u.searchParams.get("limit"),"20");
    const offset=Number(u.searchParams.get("offset"));
    if(offset===0)scan++;
    const collection=rowsByScan[Math.min(scan,rowsByScan.length-1)];
    if(opts.mutate) return opts.mutate({u,offset,scan,collection,calls});
    const page=collection.slice(offset,offset+20);
    const range=page.length?
      offset+"-"+(offset+page.length-1)+"/"+collection.length:"*/0";
    return respond(page,range,offset+page.length<collection.length?206:200);
  };
  return {fetcher,calls};
}
const read=(fetcher,jwt=subjectJwt(),signal)=>
  fetchProductionOwnerRlsFingerprints({
    branchId:RELEASE_NEON_BRANCH,jwt,fetcher,signal,
  });

test("empty Production inventory requires Owner self-grant and explicit */0",async()=>{
  const {fetcher,calls}=fakeOwner([[]]);
  const result=await read(fetcher);
  assert.equal(calls.length,2);
  assert.equal(result.numberOfNotes,0);
  assert.deepEqual(result.fingerprints,[]);
  assert.deepEqual({
    branch:result.branchId,full:result.fullInventory,owner:result.ownerRlsVerified,
    writes:result.writeEnabled,
  },{branch:RELEASE_NEON_BRANCH,full:true,owner:true,writes:false});
});

test("one note becomes portable SHA and revision without leaking private fields",async()=>{
  const note=record(1);
  const {fetcher,calls}=fakeOwner([[note]]);
  const output=await read(fetcher);
  assert.equal(calls.length,2);
  assert.equal(output.numberOfNotes,1);
  const expectedMd=serializeObsidianMarkdown({
    title:note.title,slug:note.slug,excerpt:note.summary,
    category:note.category,tags:note.tags,
    learned_on:note.learned_on,content_md:note.content_md,
  });
  const digest=s=>createHash("sha256").update(s).digest("hex");
  assert.deepEqual(output.fingerprints,[{
    slug:note.slug,sha256:digest(expectedMd),
    revision:digest(note.id+":"+note.updated_at),
  }]);
  assert.doesNotMatch(JSON.stringify(output),/Synthetic 1|only test notes|00000000|content_md|syntheticsignature/);
});

test("25 notes paginate and require a second identical full pass",async()=>{
  const list=rows(25);
  const {fetcher,calls}=fakeOwner([list,list]);
  const result=await read(fetcher);
  assert.equal(result.numberOfNotes,25);
  assert.equal(new Set(result.fingerprints.map(x=>x.slug)).size,25);
  assert.equal(calls.length,5,"one grant + two full 20/5 page passes");
  assert.deepEqual(calls.slice(1).map(x=>x.url.searchParams.get("offset")),
    ["0","20","0","20"]);
});

test("500-note upper limit succeeds, and 501 is rejected",async()=>{
  const good=fakeOwner([rows(500)]);
  const result=await read(good.fetcher);
  assert.equal(result.numberOfNotes,500);
  assert.equal(good.calls.length,51);
  const tooLarge=fakeOwner([rows(501)]);
  await assert.rejects(read(tooLarge.fetcher),/unavailable or inconsistent/);
  assert.equal(tooLarge.calls.length,2);
});

test("mid-pagination edits or shrunk totals reject full-inventory claims",async()=>{
  const original=rows(25),changed=rows(25);
  changed[0]={...changed[0],updated_at:"2026-10-29T04:00:00Z"};
  const unstable=fakeOwner([original,changed]);
  await assert.rejects(read(unstable.fetcher),/unavailable or inconsistent/);
  assert.equal(unstable.calls.length,5);
  const shrink=fakeOwner([original],{
    mutate:({offset,collection})=>{
      if(offset===0)return respond(collection.slice(0,20),"0-19/25",206);
      return respond(collection.slice(20,24),"20-23/24",200);
    },
  });
  await assert.rejects(read(shrink.fetcher),/unavailable or inconsistent/);
});

test("Owner grant cannot be inferred from 200 plus empty notes",async()=>{
  for(const grant of [
    [],[{user_id:"different"}],
    [{user_id:SUB,other:"private"}],
    [{user_id:SUB},{user_id:SUB}],
    "invalid",
  ]){
    const {fetcher,calls}=fakeOwner([[]],{grant});
    await assert.rejects(read(fetcher),/unavailable or inconsistent/);
    assert.equal(calls.length,1);
  }
});

test("bad JWT and Sandbox branch reject before any network",async()=>{
  const valid=subjectJwt();
  let sent=0;
  const fetcher=async()=>{sent++;return respond([],"*/0");};
  for(const jwt of [
    "", "a.b.c",valid.slice(0,-20),
    subjectJwt({sub:"../bad"}),
    subjectJwt({exp:Math.floor(Date.now()/1000)-10}),
  ])await assert.rejects(read(fetcher,jwt));
  await assert.rejects(fetchProductionOwnerRlsFingerprints({
    branchId:"br-quiet-sunset-b4xx4pnx",jwt:valid,fetcher,
  }));
  assert.equal(sent,0);
});

test("server clamps, unknown ranges or invalid totals fail closed",async()=>{
  for(const mutate of [
    ({collection})=>respond(collection.slice(0,1),"0-0/24",206),
    ({collection})=>respond(collection.slice(0,20),null,206),
    ({collection})=>respond(collection.slice(0,20),"0-19/*",206),
    ({collection})=>respond(collection.slice(0,20),"0-19/10",206),
    ({collection})=>respond(collection.slice(0,20),"0-19/999",206),
    ({collection})=>respond(collection.slice(0,20),"1-20/24",206),
    ({collection})=>respond(collection.slice(0,20),"0-19/24",200,
      {"content-type":"text/html"}),
  ]){
    const {fetcher}=fakeOwner([rows(24)],{mutate});
    await assert.rejects(read(fetcher),/unavailable or inconsistent/);
  }
});

test("private fields must be exact, valid and bounded before hashing",async()=>{
  for(const corrupted of [
    {id:"not-a-uuid"},{slug:"../bad"},{slug:"UPPER"},{title:""},
    {content_md:"x".repeat(200_001)},{tags:["x".repeat(29)]},
    {learned_on:"not-a-date"},{updated_at:"no-date"},
    {extraPrivateField:"MUST_NOT_LEAK"},
  ]){
    const {fetcher}=fakeOwner([[record(1,corrupted)]]);
    await assert.rejects(read(fetcher),/unavailable or inconsistent/);
  }
});

test("duplicate id, slug, or disordered server page is refused",async()=>{
  const base=rows(25);
  for(const collection of [
    [...base.slice(0,24),{...base[24],id:base[0].id}],
    [...base.slice(0,24),{...base[24],slug:base[0].slug}],
  ]){
    const {fetcher}=fakeOwner([collection]);
    await assert.rejects(read(fetcher),/unavailable or inconsistent/);
  }
  const unordered=fakeOwner([[record(2),record(1)]]);
  await assert.rejects(read(unordered.fetcher),/unavailable or inconsistent/);
});

test("auth redirect, malformed body and non-JSON never expose private data",async()=>{
  const token=subjectJwt();
  for(const response of [
    new Response("PRIVATE_JWT_SECRET",{status:401}),
    new Response("<html>PRIVATE_JWT_SECRET</html>",{status:200,headers:{"content-type":"text/html"}}),
    new Response("",{status:302,headers:{"location":"https://attacker.example"}}),
    respond([{user_id:SUB}],"0-0/1",206),
  ]){
    let calls=0;
    const fetcher=async()=>{calls++;return response;};
    await assert.rejects(read(fetcher,token),err=>{
      assert.doesNotMatch(String(err.message),/PRIVATE_JWT_SECRET|attacker.example/);
      return true;
    });
    assert.equal(calls,1);
  }
});

test("network exception messages cannot leak a Production JWT, URL or note contents",async()=>{
  const jwt=subjectJwt();
  const fetcher=async()=>{throw Error("PRIVATE_JWT_SECRET https://host.private/path");};
  await assert.rejects(read(fetcher,jwt),error=>{
    assert.match(error.message,/unavailable or inconsistent/);
    assert.doesNotMatch(error.message,/PRIVATE_JWT_SECRET|host.private|syntheticsignature/);
    return true;
  });
});

test("declared oversized content and aborted scans never return an inventory",async()=>{
  const {fetcher}=fakeOwner([[]],{
    mutate:()=>respond([],"*/0",200,{"content-length":"9000000"}),
  });
  await assert.rejects(read(fetcher),/unavailable or inconsistent/);
  const abort=new AbortController();
  const expired=fakeOwner([rows(25)],{
    mutate:({collection,offset})=>{
      if(offset===20)abort.abort();
      return respond(collection.slice(offset,offset+20),
        offset===0?"0-19/25":"20-24/25",offset===0?206:200);
    },
  });
  await assert.rejects(read(expired.fetcher,subjectJwt(),abort.signal),/unavailable or inconsistent/);
});

test("source never sends POST, logs Markdown or enables transfers",async()=>{
  const src=await import("node:fs/promises").then(fs=>fs.readFile(
    new URL("../lib/obsidian-m8-production-inventory-readonly.ts",import.meta.url),"utf8"));
  assert.doesNotMatch(src,/method:"POST"|method:"DELETE"|method:"PATCH"|console\.log|writeFile\(|rename\(|\.insert\(|\.delete\(|\.rpc\(/);
});
