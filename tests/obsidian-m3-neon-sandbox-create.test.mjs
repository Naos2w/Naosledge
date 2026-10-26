import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {createNeonSandboxNoteOnly} from "../lib/obsidian-neon-sandbox-create.ts";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
} from "../lib/obsidian-neon-sandbox-readonly.ts";
import {
  assertManualM3Invocation,readScratchCreateRequest,createOneReviewedScratchNote,
  M3_SCRATCH_ONLY_FLAG,
} from "../scripts/obsidian-m3-sandbox-manual-create.ts";

const owner="m3-sandbox-offline-owner";
const jwt="header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const draft={
  slug:"create-only-test",title:"Sandbox create-only",excerpt:"Offline test",
  content_md:"# Body\n\nTest content",category:"筆記",tags:["test"],
  learned_on:"2026-10-24",
};
const markdown=serializeObsidianMarkdown(draft);
const digest=createHash("sha256").update(markdown).digest("hex");
const decision={
  slug:draft.slug,choice:"review-missing-remote",manualReview:true,
  expectedLocalSha:digest,expectedRemoteSha:null,expectedRemoteRevision:null,
};
const options={
  branchId:NEON_SYNC_SANDBOX_BRANCH,sandboxOwnerJwt:jwt,
  decision,readMarkdown:async()=>markdown,typedConfirmation:"CREATE SANDBOX "+draft.slug,
};
const asJson=(v,status=200,inventory=false)=>new Response(JSON.stringify(v),{
  status,headers:{
    "content-type":"application/json",
    ...(inventory?{"content-range":v.length?"0-"+(v.length-1)+"/"+v.length:"*/0"}:{}),
  },
});
function fakeNetwork({ownerGranted=true,exists=false,createStatus=201}={}){
  const calls=[];
  let note=exists?row():null;
  async function fetcher(raw,req){
    const url=new URL(raw);
    assert.equal(url.origin,new URL(NEON_SYNC_SANDBOX_DATA_API).origin);
    assert.equal(req.redirect,"manual");
    assert.equal(req.credentials,"omit");
    assert.equal(req.headers.Authorization,"Bearer "+jwt);
    calls.push(req.method+" "+url.pathname);
    if(url.pathname.endsWith("/blog_admins")){
      assert.equal(req.method,"GET");
      return asJson(ownerGranted?[{user_id:owner}]:[]);
    }
    if(url.pathname.endsWith("/knowledge_notes")&&req.method==="GET"){
      assert.equal(req.headers.Prefer,"count=exact");
      return asJson(note?[note]:[],200,true);
    }
    if(url.pathname.endsWith("/knowledge_notes")&&req.method==="POST"){
      assert.equal(req.headers.Prefer,"return=representation");
      assert.equal(url.searchParams.get("select"),"id,slug");
      assert.equal(req.headers["Content-Type"],"application/json");
      assert.equal(req.cache,"no-store");
      assert.equal(req.body===undefined,false);
      const body=JSON.parse(req.body);
      assert.deepEqual(body,{
        slug:draft.slug,title:draft.title,summary:draft.excerpt,
        content_md:draft.content_md,category:draft.category,tags:draft.tags,
        learned_on:draft.learned_on,
      });
      if(createStatus===409)return asJson({message:"duplicate"},409);
      note=row();
      return asJson([{id:note.id,slug:note.slug}],201);
    }
    throw Error("Unexpected HTTP request");
  }
  return {fetcher,calls};
}
function row(){
  return {
    id:"b3e9f7b4-7c4a-4f86-98df-d8e1c21912a0",
    slug:draft.slug,title:draft.title,summary:draft.excerpt,
    content_md:draft.content_md,category:draft.category,tags:draft.tags,
    learned_on:draft.learned_on,updated_at:"2026-10-24T11:00:00.000Z",
  };
}
test("M3 real-shaped Sandbox POST creates exactly one note, then GET re-verifies content; no Baseline",async()=>{
  const n=fakeNetwork();
  const result=await createNeonSandboxNoteOnly({...options,fetcher:n.fetcher});
  assert.deepEqual(n.calls,[
    "GET /neondb/rest/v1/blog_admins",
    "GET /neondb/rest/v1/knowledge_notes",
    "POST /neondb/rest/v1/knowledge_notes",
    "GET /neondb/rest/v1/knowledge_notes",
  ]);
  assert.equal(result.sha256,digest);
  assert.equal(result.baselineSaved,false);
  assert.match(result.revision,/^[0-9a-f]{64}$/);
});
test("M3 refuses missing individual consent, modified content, and existing remote without POST",async()=>{
  const n=fakeNetwork();
  await assert.rejects(createNeonSandboxNoteOnly({
    ...options,typedConfirmation:"",fetcher:n.fetcher,
  }),/confirmation/);
  assert.deepEqual(n.calls,[],"missing consent must fail before any request");
  await assert.rejects(createNeonSandboxNoteOnly({
    ...options,readMarkdown:async()=>markdown+" changed",fetcher:n.fetcher,
  }),/exact reviewed/);
  assert.deepEqual(n.calls,[
    "GET /neondb/rest/v1/blog_admins","GET /neondb/rest/v1/knowledge_notes",
  ],"a changed local note must fail after Owner GET and before POST");
  const other=fakeNetwork({exists:true});
  await assert.rejects(createNeonSandboxNoteOnly({...options,fetcher:other.fetcher}),
    /remote note exists/);
  assert.deepEqual(other.calls,[
    "GET /neondb/rest/v1/blog_admins","GET /neondb/rest/v1/knowledge_notes",
  ]);
});
test("M3 refuses to create a WikiLinked note without atomic backlink maintenance",async()=>{
  const linkedMarkdown=serializeObsidianMarkdown({
    ...draft,content_md:"A reference to [[another-note]]",
  });
  const n=fakeNetwork();
  await assert.rejects(createNeonSandboxNoteOnly({
    ...options,decision:{...decision,
      expectedLocalSha:createHash("sha256").update(linkedMarkdown).digest("hex"),
    },readMarkdown:async()=>linkedMarkdown,fetcher:n.fetcher,
  }),/cannot maintain WikiLinks atomically/);
  assert.deepEqual(n.calls,[
    "GET /neondb/rest/v1/blog_admins",
    "GET /neondb/rest/v1/knowledge_notes",
  ],"unsupported linked note must not reach POST");
});

test("M3 reads local source only after fresh Owner inventory, never from cached M1 text",async()=>{
  const n=fakeNetwork();
  const events=[];
  const result=await createNeonSandboxNoteOnly({
    ...options,
    fetcher:async(...args)=>{
      events.push("remote:"+args[1].method);
      return n.fetcher(...args);
    },
    readMarkdown:async()=>{
      events.push("local:re-read");
      return markdown;
    },
  });
  assert.equal(result.sha256,digest);
  assert.deepEqual(events,["remote:GET","remote:GET","local:re-read","remote:POST","remote:GET"]);
});

test("M3 rejects missing Owner RLS proof before POST",async()=>{
  const n=fakeNetwork({ownerGranted:false});
  await assert.rejects(createNeonSandboxNoteOnly({...options,fetcher:n.fetcher}),/Owner RLS grant/);
  assert.deepEqual(n.calls,["GET /neondb/rest/v1/blog_admins"]);
});
test("M3 remote concurrent duplicate produces 409; never updates, deletes or retries",async()=>{
  const n=fakeNetwork({createStatus:409});
  await assert.rejects(createNeonSandboxNoteOnly({...options,fetcher:n.fetcher}),/insert was rejected/);
  assert.deepEqual(n.calls,[
    "GET /neondb/rest/v1/blog_admins","GET /neondb/rest/v1/knowledge_notes",
    "POST /neondb/rest/v1/knowledge_notes",
  ]);
});

test("M3 manual scratch entry requires MSI, explicit flag, and secret pipe",async()=>{
  assertManualM3Invocation("win32","MSI",[M3_SCRATCH_ONLY_FLAG],false);
  for(const args of [
    ["linux","MSI",[M3_SCRATCH_ONLY_FLAG],false],
    ["win32","OTHER",[M3_SCRATCH_ONLY_FLAG],false],
    ["win32","MSI",[],false],
    ["win32","MSI",[M3_SCRATCH_ONLY_FLAG],true],
  ]){
    assert.throws(()=>assertManualM3Invocation(...args),/explicit piped scratch-only/);
  }
  await assert.rejects(readScratchCreateRequest(["not JSON"]),/must be JSON/);
  await assert.rejects(readScratchCreateRequest([JSON.stringify({
    sandboxOwnerJwt:jwt,markdown,typedConfirmation:"CREATE SANDBOX "+draft.slug,
    extra:"not allowed",
  })]),/exactly one note/);
});

test("M3 scratch-only stdin carries one human-approved note to live-shaped Sandbox transport",async()=>{
  const request=await readScratchCreateRequest([JSON.stringify({
    sandboxOwnerJwt:jwt,markdown,typedConfirmation:"CREATE SANDBOX "+draft.slug,
  })]);
  const n=fakeNetwork();
  assert.deepEqual(await createOneReviewedScratchNote(request,n.fetcher),
    {baselineSaved:false});
  assert.equal(n.calls.filter(c=>c.startsWith("POST ")).length,1);

  const blocked=fakeNetwork();
  await assert.rejects(createOneReviewedScratchNote({
    ...request,typedConfirmation:"",
  },blocked.fetcher),/typed per-note confirmation/);
  assert.deepEqual(blocked.calls,[],"invalid consent never reaches Neon");

  await assert.rejects(createOneReviewedScratchNote({
    ...request,markdown:"non-portable prefix\n"+markdown,
  },blocked.fetcher),/canonical portable/);
  assert.deepEqual(blocked.calls,[],"noncanonical text never reaches Neon");
});
