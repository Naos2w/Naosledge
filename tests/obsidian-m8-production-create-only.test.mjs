import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createProductionNoteOnce}
  from "../lib/obsidian-m8-production-cas-update.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {RELEASE_NEON_BRANCH,RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const ID="00000000-0000-4000-8000-000000000122";
const JWT="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub:SUB,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".syntheticsignature";
const SLUG="m8-create-only";
const UPDATED="2026-10-29T03:00:00Z";
const md={
  slug:SLUG,title:"P1 synthetic",excerpt:"test only",
  content_md:"# Create-only\n\n[[test-link]]",
  category:"test",tags:["safe"],learned_on:"2026-10-29",
};
const source=serializeObsidianMarkdown(md);
const sha=v=>createHash("sha256").update(v).digest("hex");
const candidate={
  slug:SLUG,choice:"review-missing-remote",action:"upload-create",
  executable:false,automaticDeletionAllowed:false,
  requiresFreshTwoSidedRead:true,requiresDurableBackup:false,
  baselineCommitOnlyAfterVerifiedReadback:true,
  expectedLocalSha:sha(source),expectedRemoteSha:null,expectedRemoteRevision:null,
};
const opt=(fetcher,more={})=>({
  branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT,
  candidate:{...candidate},
  readLocalMarkdown:async()=>source,
  typedConfirmation:"TEST M8 PRODUCTION CREATE "+SLUG+" "+
    candidate.expectedLocalSha.slice(0,12),
  fetcher,...more,
});
const json=(value,range,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{"content-type":"application/json",
    ...(range?{"content-range":range}:{})},
});
function fake(opts={}){
  let row=opts.existing?{
    id:ID,slug:SLUG,title:md.title,summary:md.excerpt,
    content_md:md.content_md,category:md.category,
    tags:md.tags,learned_on:md.learned_on,updated_at:UPDATED,
  }:null;
  let links=opts.existing?["test-link"]:[];
  let posts=0,gets=0;
  const fetcher=async(url,req)=>{
    const u=new URL(url);
    assert.equal(u.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(req.headers.Authorization,"Bearer "+JWT);
    assert.equal(req.redirect,"manual");
    if(u.pathname.endsWith("/blog_admins"))
      return json(opts.noOwner?[]:[{user_id:SUB}],"0-0/1");
    if(u.pathname.endsWith("/knowledge_notes")){
      gets++;
      return json(row?[row]:[],row?"0-0/1":"*/0");
    }
    if(u.pathname.endsWith("/knowledge_links")){
      return json(links.map(target_key=>({target_key})),
        links.length?"0-"+(links.length-1)+"/"+links.length:"*/0");
    }
    if(u.pathname.endsWith("/rpc/save_knowledge_note")){
      posts++;
      assert.equal(req.method,"POST");
      const body=JSON.parse(req.body);
      assert.equal(body.p_id,null);
      assert.equal(body.p_slug,SLUG);
      assert.deepEqual(body.p_links,["test-link"]);
      if(opts.conflictingInsert)row={
        id:ID,slug:SLUG,title:"Other Owner session version",summary:"",
        content_md:"# concurrent",category:"test",
        tags:[],learned_on:"2026-10-29",updated_at:UPDATED,
      };
      if(row)return new Response(JSON.stringify({code:"23505"}),{
        status:409,headers:{"content-type":"application/json"},
      });
      row={
        id:ID,slug:body.p_slug,title:body.p_title,
        summary:body.p_summary,content_md:body.p_content_md,
        category:body.p_category,tags:body.p_tags,
        learned_on:body.p_learned_on,updated_at:UPDATED,
      };
      links=body.p_links;
      if(opts.dropResponseAfterCommit)throw Error("PRIVATE_NETWORK_ERROR");
      return json(ID,null);
    }
    throw Error("unexpected test route");
  };
  return {fetcher,get posts(){return posts},
    get gets(){return gets},get note(){return row},get links(){return links}};
}

test("Production Owner-RLS create-only RPC uses null ID, inserts WikiLinks and verifies the exact readback",async()=>{
  const s=fake();
  const result=await createProductionNoteOnce(opt(s.fetcher));
  assert.deepEqual(result,{
    slug:SLUG,sha256:candidate.expectedLocalSha,
    revision:sha(ID+":"+UPDATED),
    verifiedRemoteReadback:true,baselineSaved:false,
    automaticRetryAllowed:false,
  });
  assert.equal(s.posts,1);
  assert.equal(s.note.slug,SLUG);
  assert.equal(s.note.content_md,md.content_md);
  assert.deepEqual(s.links,["test-link"]);
});

test("a pre-existing Production note cannot become an UPSERT or overwrite",async()=>{
  const s=fake({existing:true});
  await assert.rejects(createProductionNoteOnce(opt(s.fetcher)),/stopped/);
  assert.equal(s.posts,0);
  assert.equal(s.note.title,md.title);
});

test("unique-constraint race during create-only cannot update a concurrent note",async()=>{
  const s=fake({conflictingInsert:true});
  await assert.rejects(createProductionNoteOnce(opt(s.fetcher)),/outcome uncertain/);
  assert.equal(s.posts,1);
  assert.equal(s.note.content_md,"# concurrent");
});

test("lost POST response after insert is uncertain and never automatically retried",async()=>{
  const s=fake({dropResponseAfterCommit:true});
  await assert.rejects(createProductionNoteOnce(opt(s.fetcher)),err=>{
    assert.match(err.message,/outcome uncertain.*do not retry/);
    assert.doesNotMatch(err.message,/PRIVATE_NETWORK_ERROR/);
    return true;
  });
  assert.equal(s.posts,1);
  assert.equal(s.note.content_md,md.content_md);
});

test("invalid approval or a changed local Markdown file prevents Production write",async()=>{
  for(const more of [
    {typedConfirmation:""},
    {candidate:{...candidate,action:"upload-cas"}},
    {candidate:{...candidate,executable:true}},
    {candidate:{...candidate,expectedRemoteSha:"a".repeat(64)}},
    {branchId:"br-quiet-sunset-b4xx4pnx"},
  ]){
    const s=fake();
    await assert.rejects(createProductionNoteOnce(opt(s.fetcher,more)));
    assert.equal(s.gets,0);
    assert.equal(s.posts,0);
  }
  const s=fake();
  let reads=0;
  await assert.rejects(createProductionNoteOnce(opt(s.fetcher,{
    readLocalMarkdown:async()=>{
      reads++;
      return reads===1?source:"# edited while awaiting cloud";
    },
  })));
  assert.equal(s.posts,0);
  assert.equal(reads,2);
});

test("lack of actual Owner RLS self-grant rejects create before inventory or SQL writes",async()=>{
  const s=fake({noOwner:true});
  await assert.rejects(createProductionNoteOnce(opt(s.fetcher)));
  assert.equal(s.posts,0);
  assert.equal(s.gets,0);
});
