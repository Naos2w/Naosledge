import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  fetchNeonSandboxFingerprints,NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";

const jwt="synthetic.sandbox.signature";
const row=(slug="neon-rls")=>({
  id:"00000000-0000-4000-8000-000000000001",
  slug,title:"Neon RLS 測試",summary:"Safe synthetic only",
  content_md:"## 私人合成測試\n\n[[obsidian-sync]]",
  category:"QA",tags:["Neon","Sandbox"],learned_on:"2026-10-19",
  updated_at:"2026-10-19T06:00:00.123Z",
});
const json=(data,{status=200,headers={}}={})=>new Response(JSON.stringify(data),{
  status,headers:{
    "content-type":"application/json",
    ...(Array.isArray(data)?{"content-range":data.length?
      `0-${data.length-1}/${data.length}`:"*/0"}:{}),
    ...headers,
  },
});
const req=(fetcher,more={})=>fetchNeonSandboxFingerprints({
  branchId:NEON_SYNC_SANDBOX_BRANCH,jwt,fetcher,...more,
});

test("RLS-only GET goes exclusively to the approved Neon integration sandbox",async()=>{
  let count=0;
  const actual=await req(async(url,opts)=>{
    count++;
    const target=new URL(url);
    assert.equal(target.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(target.pathname,"/neondb/rest/v1/knowledge_notes");
    assert.equal(target.searchParams.get("limit"),"21");
    assert.equal(target.searchParams.get("order"),"updated_at.desc");
    assert.match(target.searchParams.get("select"),/content_md/);
    assert.equal(opts.method,"GET");
    assert.equal(opts.redirect,"manual");
    assert.equal(opts.credentials,"omit");
    assert.equal(opts.headers.Authorization,"Bearer "+jwt);
    assert.equal(opts.headers.Accept,"application/json");
    assert.equal(opts.headers.Prefer,"count=exact");
    assert.equal(opts.body,undefined);
    assert.ok(opts.signal instanceof AbortSignal);
    return json([row()]);
  });
  assert.equal(count,1);
  const original=row();
  const markdown=serializeObsidianMarkdown({
    title:original.title,slug:original.slug,
    excerpt:original.summary,category:original.category,
    tags:original.tags,learned_on:original.learned_on,
    content_md:original.content_md,
  });
  assert.deepEqual(actual.fingerprints,[{
    slug:"neon-rls",sha256:createHash("sha256").update(markdown).digest("hex"),
    revision:createHash("sha256").update(original.id+":"+original.updated_at).digest("hex"),
  }]);
  assert.equal(actual.sandboxOnly,true);
  assert.equal(actual.rlsEnforcedByDataApi,true);
  assert.equal(actual.writeEnabled,false);
  assert.equal(actual.fullInventory,true);
  assert.equal(actual.numberOfNotes,1);
  assert.doesNotMatch(JSON.stringify(actual),/私人的|私人合成測試|Safe synthetic only|Bearer|owner_id/);
});

test("empty sandbox under an authenticated RLS owner yields empty full inventory",async()=>{
  const result=await req(async()=>json([]));
  assert.deepEqual(result.fingerprints,[]);
  assert.equal(result.numberOfNotes,0);
  assert.equal(result.fullInventory,true);
});

test("production/unknown branch and malformed token always reject before network",async()=>{
  let calls=0;
  const fake=async()=>{calls++;return json([]);};
  for(const branchId of ["br-aged-sound-b43h5r2c","","other-sandbox",null]){
    await assert.rejects(req(fake,{branchId}),/approved Neon integration Sandbox/);
  }
  for(const token of ["","opaque","fake fake fake","a.b",("a".repeat(9000)),"a.b.c\nInjected"]){
    await assert.rejects(req(fake,{jwt:token}),/synthetic sandbox JWT/);
  }
  assert.equal(calls,0);
});

test("anonymous and non-owner responses fail closed without reading any body",async()=>{
  for(const code of [401,403]){
    const message="PRIVATE_REMOTE_MESSAGE_MUST_NEVER_LEAK";
    await assert.rejects(req(async()=>json({error:message},{status:code})),err=>{
      assert.match(err.message,/unauthenticated|not an authorized Vault owner/);
      assert.doesNotMatch(err.message,/PRIVATE_REMOTE_MESSAGE/);
      return true;
    });
  }
});

test("SSO redirect, outage and HTML are never treated as an empty library",async()=>{
  await assert.rejects(req(async()=>new Response(null,{
    status:302,headers:{location:"https://vercel.com/sso-api"},
  })),/inventory unavailable/);
  await assert.rejects(req(async()=>json({error:"down"},{status:503})),/inventory unavailable/);
  await assert.rejects(req(async()=>new Response("<html>login</html>",{
    status:200,headers:{"content-type":"text/html"},
  })),/did not return JSON/);
});

test("truncated inventory fails closed before attempting to synchronize",async()=>{
  const many=Array.from({length:21},(_,i)=>({
    ...row("synthetic-"+i),
    id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
  }));
  await assert.rejects(req(async()=>json(many)),/too large or invalid/);
});

test("malformed note or duplicate slugs cannot silently enter sync plan",async()=>{
  const bad=[
    { ...row(),slug:"../unsafe" },
    { ...row(),title:123 },
    { ...row(),tags:["ok",123] },
    { ...row(),content_md:null },
    { ...row(),learned_on:"October 19" },
    { ...row(),updated_at:"invalid" },
    { ...row(),id:"not-a-uuid" },
    { ...row(),content_md:"✅".repeat(100000) }, // UTF8 too large
  ];
  for(const item of bad)await assert.rejects(req(async()=>json([item])),/malformed/);
  await assert.rejects(req(async()=>json([row(),row()])),/malformed/);
  await assert.rejects(req(async()=>json({rows:[row()]})),/too large or invalid/);
});

test("large response Content-Length is refused before parsing",async()=>{
  const res=new Response("{}",{status:200,headers:{
    "content-type":"application/json","content-length":"6000000",
  }});
  await assert.rejects(req(async()=>res),/read-only inventory limit/);
});

test("response parsing errors never expose note bodies or JWT contents",async()=>{
  await assert.rejects(req(async()=>new Response('{"private":"SECRET_NEON_MARKDOWN"',{
    status:200,headers:{"content-type":"application/json"},
  })),err=>{
    assert.match(err.message,/unparseable inventory/);
    assert.doesNotMatch(err.message,/SECRET_NEON_MARKDOWN|synthetic|signature/);
    return true;
  });
});

test("M1 inventory requires an exact complete PostgREST count, never a truncated or unverifiable page",async()=>{
  for(const [data,reported] of [
    [[],null], // No proof that an empty result is the full RLS-visible set.
    [[],"*/*"],
    [[],"*/5"], // A hidden page must not be treated as all notes deleted.
    [[row()],"0-0/*"],
    [[row()],"0-0/2"], // Server may have truncated a larger inventory.
    [[row()],"1-1/1"], // Nonzero offset is not the complete inventory.
    [[row()],"0-1/1"], // Header claims rows not present in the body.
  ]){
    const headers=reported===null?{"content-range":""}:{"content-range":reported};
    await assert.rejects(req(async()=>json(data,{headers})),
      /range incomplete or unverified/);
  }
  assert.equal((await req(async()=>json([]))).fullInventory,true);
  assert.equal((await req(async()=>json([row()]))).numberOfNotes,1);
});

test("remote ordering is stable by safe slug not server's update ordering",async()=>{
  const b={...row("zed-note"),id:"00000000-0000-4000-8000-000000000002"};
  const a=row("alpha-note");
  const result=await req(async()=>json([b,a]));
  assert.deepEqual(result.fingerprints.map(x=>x.slug),["alpha-note","zed-note"]);
  assert.equal(result.fullInventory,true);
});
