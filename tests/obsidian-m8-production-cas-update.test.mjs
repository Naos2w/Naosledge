import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {
  fetchVerifiedProductionNoteMarkdown,
} from "../lib/obsidian-m8-production-inventory-readonly.ts";
import {updateProductionNoteCasOnce}
  from "../lib/obsidian-m8-production-cas-update.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {RELEASE_NEON_BRANCH,RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";
import {extractWikiReferences} from "../lib/wiki-links.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const ID="00000000-0000-4000-8000-000000000099";
const SLUG="m8-synthetic-note";
const INITIAL="2026-10-29T01:00:00.000Z";
const UPDATED="2026-10-29T01:02:00.000Z";
const JWT="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub:SUB,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".syntheticsignature";
const sha=s=>createHash("sha256").update(s).digest("hex");
const old={
  id:ID,slug:SLUG,title:"Synthetic P1",summary:"synthetic only",
  content_md:"# Old\n\n[[old-link]]",category:"test",
  tags:["p1"],learned_on:"2026-10-29",updated_at:INITIAL,
};
const newContent="# New\n\n[[new-link]]";
const format=row=>serializeObsidianMarkdown({
  slug:row.slug,title:row.title,excerpt:row.summary,
  category:row.category,tags:row.tags,learned_on:row.learned_on,
  content_md:row.content_md,
});
const originalMarkdown=format(old);
const nextMarkdown=format({...old,content_md:newContent});
const oldFingerprint={sha256:sha(originalMarkdown),revision:sha(ID+":"+INITIAL)};
const nextFingerprint={sha256:sha(nextMarkdown),revision:sha(ID+":"+UPDATED)};
const candidate={
  slug:SLUG,choice:"review-upload",action:"upload-cas",
  executable:false,automaticDeletionAllowed:false,
  requiresFreshTwoSidedRead:true,requiresDurableBackup:false,
  baselineCommitOnlyAfterVerifiedReadback:true,
  expectedLocalSha:nextFingerprint.sha256,
  expectedRemoteSha:oldFingerprint.sha256,
  expectedRemoteRevision:oldFingerprint.revision,
};
const opt=(fetcher,more={})=>({
  branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT,
  candidate:{...candidate},
  readLocalMarkdown:async()=>nextMarkdown,
  typedConfirmation:"TEST M8 PRODUCTION CAS "+SLUG+" "+
    nextFingerprint.sha256.slice(0,12),
  fetcher,...more,
});
const json=(value,range,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json",
    ...(range?{"content-range":range}:{})},
});
function fakeServer(opts={}){
  let note={...old};
  let links=["old-link"];
  let posts=0,gets=0,grantReads=0;
  let badNext=false;
  const trace=[];
  const fetcher=async(url,req)=>{
    const u=new URL(url);
    const pathname=u.pathname;
    trace.push({method:req.method,path:pathname,query:u.searchParams.toString()});
    assert.equal(u.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(req.redirect,"manual");
    assert.equal(req.credentials,"omit");
    assert.equal(req.cache,"no-store");
    assert.equal(req.headers.Authorization,"Bearer "+JWT);
    if(pathname.endsWith("/blog_admins")){
      assert.equal(req.method,"GET");
      grantReads++;
      return json(opts.nonOwner?[]:[{user_id:SUB}],"0-0/1");
    }
    if(pathname.endsWith("/knowledge_notes")){
      assert.equal(req.method,"GET");
      gets++;
      if(opts.driftBeforePost&&gets===4){
        note={...note,updated_at:UPDATED,content_md:"# Another writer"};
      }
      const rows=note?[{...note}]:[];
      if(u.searchParams.has("slug")){
        assert.equal(u.searchParams.get("slug"),"eq."+SLUG);
        return json(rows,rows.length?"0-0/1":"*/0");
      }
      assert.equal(u.searchParams.get("select"),
        "id,slug,title,summary,content_md,category,tags,learned_on,updated_at");
      assert.equal(u.searchParams.get("limit"),"20");
      return json(rows,rows.length?"0-0/1":"*/0");
    }
    if(pathname.endsWith("/knowledge_links")){
      assert.equal(req.method,"GET");
      const keys=opts.badWikiIndex?["wrong-link"]:links;
      return json(keys.map(target_key=>({target_key})),
        keys.length?"0-"+(keys.length-1)+"/"+keys.length:"*/0");
    }
    if(pathname.endsWith("/rpc/update_knowledge_note_cas_with_links")){
      assert.equal(req.method,"POST");
      posts++;
      const body=JSON.parse(req.body);
      assert.equal(body.p_id,ID);
      assert.equal(body.p_slug,SLUG);
      assert.equal(body.p_expected_updated_at,INITIAL);
      assert.deepEqual(body.p_expected_links,["old-link"]);
      assert.deepEqual(body.p_links,["new-link"]);
      assert.equal(body.p_content_md,newContent);
      assert.equal(body.p_title,old.title);
      if(opts.sqlConcurrentUpdate){
        note={...note,updated_at:UPDATED,content_md:"# Concurrent change"};
      }
      if(note.updated_at!==body.p_expected_updated_at||
         JSON.stringify(links)!==JSON.stringify(body.p_expected_links)){
        return new Response(JSON.stringify({code:"40001"}),{
          status:409,headers:{"content-type":"application/json"},
        });
      }
      note={...note,content_md:opts.corruptAfterPost?"# Corrupt":body.p_content_md,
        updated_at:UPDATED};
      links=[...body.p_links];
      if(opts.dropResponseAfterCommit)throw Error("PRIVATE_JWT network timeout");
      return json(ID,null);
    }
    throw Error("Unexpected URL");
  };
  return {fetcher,get posts(){return posts},get gets(){return gets},
    get grantReads(){return grantReads},get note(){return note},
    get links(){return links},trace};
}

test("verified single Production Owner note returns canonical private Markdown only to caller",async()=>{
  const s=fakeServer();
  const r=await fetchVerifiedProductionNoteMarkdown({
    branchId:RELEASE_NEON_BRANCH,jwt:JWT,slug:SLUG,
    expectedSha256:oldFingerprint.sha256,
    expectedRevision:oldFingerprint.revision,
    fetcher:s.fetcher,
  });
  assert.equal(r.id,ID);
  assert.equal(r.updatedAt,INITIAL);
  assert.equal(r.markdown,originalMarkdown);
  assert.equal(r.sha256,oldFingerprint.sha256);
  assert.equal(r.revision,oldFingerprint.revision);
  assert.equal(s.posts,0);
  assert.ok(s.grantReads>=2);
});

test("Production CAS uses only SQL003 atomic RPC and verifies new body, revision and links",async()=>{
  const s=fakeServer();
  const result=await updateProductionNoteCasOnce(opt(s.fetcher));
  assert.deepEqual(result,{
    slug:SLUG,sha256:nextFingerprint.sha256,revision:nextFingerprint.revision,
    verifiedRemoteReadback:true,incomingWrites:0,baselineSaved:false,
    automaticRetryAllowed:false,
  });
  assert.equal(s.posts,1);
  assert.equal(s.note.content_md,newContent);
  assert.deepEqual(s.links,["new-link"]);
  assert.ok(s.gets>3);
  assert.ok(s.grantReads>=4);
  assert.equal(s.trace.filter(x=>x.method!=="GET"&&x.method!=="POST").length,0);
  assert.equal(s.trace.filter(x=>x.method==="POST").length,1);
});

test("candidate without exact QA approval or wrong action rejects BEFORE any Owner read",async()=>{
  for(const diff of [
    {typedConfirmation:""},
    {candidate:{...candidate,action:"manual-conflict"}},
    {candidate:{...candidate,choice:"conflict"}},
    {candidate:{...candidate,executable:true}},
    {candidate:{...candidate,expectedRemoteRevision:null}},
    {candidate:{...candidate,expectedRemoteSha:nextFingerprint.sha256}},
    {branchId:"br-quiet-sunset-b4xx4pnx"},
  ]){
    const s=fakeServer();
    await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher,diff)));
    assert.equal(s.posts,0);
    assert.equal(s.gets,0);
    assert.equal(s.grantReads,0);
  }
});

test("non-Owner RLS cannot reach any SQL update even if notes are visible to a bad fake API",async()=>{
  const s=fakeServer({nonOwner:true});
  await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher)));
  assert.equal(s.posts,0);
  assert.equal(s.gets,0);
});

test("stale expected remote SHA/revision refuses before SQL POST",async()=>{
  const s=fakeServer();
  await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher,{
    candidate:{...candidate,expectedRemoteSha:sha("not matching real remote")},
  })));
  assert.equal(s.posts,0);
});

test("local Markdown that changes during preflight cannot reach the SQL RPC",async()=>{
  const s=fakeServer();
  let calls=0;
  await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher,{
    readLocalMarkdown:async()=>{
      calls++;
      return calls===1?nextMarkdown:nextMarkdown+"changed";
    },
  })));
  assert.equal(s.posts,0);
  assert.equal(calls,2);
});

test("WikiLink index drift is rejected before SQL003",async()=>{
  const s=fakeServer({badWikiIndex:true});
  await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher)),/reconciliation/);
  assert.equal(s.posts,0);
});

test("concurrent update at the SQL003 row lock is never replaced or automatically retried",async()=>{
  const s=fakeServer({sqlConcurrentUpdate:true});
  await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher)),/outcome uncertain/);
  assert.equal(s.posts,1);
  assert.equal(s.note.content_md,"# Concurrent change");
  assert.deepEqual(s.links,["old-link"]);
});

test("a lost POST response can be a committed SQL change; never retry or record Baseline",async()=>{
  const s=fakeServer({dropResponseAfterCommit:true});
  await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher)),err=>{
    assert.match(err.message,/outcome uncertain.*do not retry/);
    assert.doesNotMatch(err.message,/PRIVATE_JWT/);
    return true;
  });
  assert.equal(s.posts,1);
  assert.equal(s.note.content_md,newContent,"POST might already have committed");
});

test("wrong post-CAS remote body refuses to certify a successful sync or M5 entry",async()=>{
  const s=fakeServer({corruptAfterPost:true});
  await assert.rejects(updateProductionNoteCasOnce(opt(s.fetcher)),/outcome uncertain/);
  assert.equal(s.posts,1);
  assert.equal(s.note.content_md,"# Corrupt");
});

test("source is not wired to the automatic host or website, and has no blind PATCH fallback",async()=>{
  const [cas,host,website]=await Promise.all([
    readFile(new URL("../lib/obsidian-m8-production-cas-update.ts",import.meta.url),"utf8"),
    readFile(new URL("../lib/obsidian-m8-readonly-host.ts",import.meta.url),"utf8"),
    readFile(new URL("../app/vault/sync/page.tsx",import.meta.url),"utf8"),
  ]);
  assert.doesNotMatch(cas,/method:"PATCH"|\.delete\(|setInterval\(/);
  assert.match(cas,/p_id:null/,"create-only SQL002 must not supply an existing ID");
  assert.doesNotMatch(host,/updateProductionNoteCasOnce|production-cas-update/);
  assert.doesNotMatch(website,/updateProductionNoteCasOnce|production-cas-update/);
});
