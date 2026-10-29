import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {inspectM8UncertainProductionOperation}
  from "../lib/obsidian-m8-uncertain-reconciliation.ts";
import {RELEASE_NEON_BRANCH}
  from "../lib/neon/production-release.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const JWT="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub:SUB,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".syntheticsignature";
const A="a".repeat(64),B="b".repeat(64),C="c".repeat(64);
const slug="uncertain-note";
const before={beforeSha256:A,beforeRevision:A};
const api=(entries)=>{
  let requests=0;
  const fetcher=async(uri,opts)=>{
    requests++;
    assert.equal(opts.method,"GET");
    const u=new URL(uri);
    if(u.pathname.endsWith("/blog_admins"))return new Response(
      JSON.stringify([{user_id:SUB}]),{status:200,headers:{"content-type":"application/json"}},
    );
    if(u.pathname.endsWith("/knowledge_notes")){
      const rows=entries.map((item,i)=>({
        id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
        slug:item.slug,title:item.slug,summary:"",
        content_md:"content",category:"test",tags:[],
        learned_on:"2026-10-29",updated_at:"2026-10-29T03:00:00Z",
      }));
      // The real M8 inventory derives its SHA/revision from this row.
      const range=rows.length?"0-"+(rows.length-1)+"/"+rows.length:"*/0";
      return new Response(JSON.stringify(rows),{status:200,headers:{
        "content-type":"application/json","content-range":range,
      }});
    }
    throw Error("unexpected endpoint");
  };
  return {fetcher,get calls(){return requests}};
};
const options=(fetcher,overrides={})=>({
  branchId:RELEASE_NEON_BRANCH,ownerJwt:JWT,slug,
  ...before,expectedSha256:B,fetcher,...overrides,
});

test("an uncertain create with no RLS-visible note is still-absent but never auto-retried",async()=>{
  const remote=api([]);
  const result=await inspectM8UncertainProductionOperation(options(remote.fetcher,{
    beforeSha256:null,beforeRevision:null,
  }));
  assert.equal(result.state,"still-absent");
  assert.equal(result.currentSha256,null);
  assert.equal(result.currentRevision,null);
  assert.equal(result.ownerRlsVerified,true);
  assert.equal(result.manualReviewRequired,true);
  assert.equal(result.automaticRetryAllowed,false);
  assert.equal(result.automaticDeletionAllowed,false);
  assert.equal(result.baselineSaved,false);
  assert.equal(result.remoteWrites,0);
  assert.equal(result.localWrites,0);
  assert.equal(remote.calls,2);
});

test("an uncertain update with missing note is never treated as a successful deletion",async()=>{
  const result=await inspectM8UncertainProductionOperation(options(api([]).fetcher));
  assert.equal(result.state,"missing-or-deleted");
  assert.equal(result.automaticRetryAllowed,false);
  assert.equal(result.baselineSaved,false);
});

test("a read-only witness classifies expected, old and divergent remote states without treating them as a checkpoint",async()=>{
  const id="00000000-0000-4000-8000-000000000001";
  const stamp="2026-10-29T03:00:00Z";
  const md=serializeObsidianMarkdown({
    slug,title:slug,excerpt:"",content_md:"content",
    category:"test",tags:[],learned_on:"2026-10-29",
  });
  const hash=s=>createHash("sha256").update(s).digest("hex");
  const actual=hash(md),rev=hash(id+":"+stamp);
  const src=api([{slug}]);
  const committed=await inspectM8UncertainProductionOperation(options(src.fetcher,{
    expectedSha256:actual,
  }));
  assert.equal(committed.state,"current-expected-content");
  assert.equal(committed.currentRevision,rev);
  assert.equal(committed.baselineSaved,false);
  assert.equal(committed.automaticRetryAllowed,false);
  const oldVersion=await inspectM8UncertainProductionOperation(options(
    api([{slug}]).fetcher,{
      beforeSha256:actual,beforeRevision:rev,expectedSha256:B,
    }));
  assert.equal(oldVersion.state,"still-old-version");
  assert.equal(oldVersion.automaticRetryAllowed,false);
  const divergent=await inspectM8UncertainProductionOperation(
    options(api([{slug}]).fetcher));
  assert.equal(divergent.state,"diverged");
  assert.equal(divergent.automaticDeletionAllowed,false);
});

test("bad input is rejected before contacting Production",async()=>{
  const fixture=api([]);
  for(const override of [
    {branchId:"br-quiet-sunset-b4xx4pnx"},
    {slug:"../private"},
    {beforeSha256:null,beforeRevision:A},
    {beforeSha256:A,beforeRevision:null},
    {expectedSha256:"short"},
    {expectedSha256:A},
  ]){
    await assert.rejects(inspectM8UncertainProductionOperation(
      options(fixture.fetcher,override),
    ));
  }
  assert.equal(fixture.calls,0);
});

test("an expired JWT or non-Owner cannot become a positive recovery status",async()=>{
  const noOwner=async uri=>{
    if(new URL(uri).pathname.endsWith("/blog_admins"))return new Response(
      JSON.stringify([]),{status:200,headers:{"content-type":"application/json"}},
    );
    throw Error("notes must not be queried");
  };
  await assert.rejects(inspectM8UncertainProductionOperation(options(noOwner)));
  const expired="eyJhbGciOiJIUzI1NiJ9."+
    Buffer.from(JSON.stringify({sub:SUB,exp:0})).toString("base64url")+".sig";
  await assert.rejects(inspectM8UncertainProductionOperation(
    options(api([]).fetcher,{ownerJwt:expired}),
  ));
});

test("reconciliation has no write API or automatic baseline commit",async()=>{
  const src=await import("node:fs/promises").then(fs=>fs.readFile(
    new URL("../lib/obsidian-m8-uncertain-reconciliation.ts",import.meta.url),"utf8"));
  assert.doesNotMatch(src,/method:"POST"|method:"PATCH"|method:"DELETE"|writeFile\(|rename\(|setInterval\(|\\.rpc\(/);
});
