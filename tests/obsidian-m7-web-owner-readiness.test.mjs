import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {
  observeM7ProductionOwnerWebReadiness,
} from "../lib/obsidian-m7-web-owner-readiness.ts";
import {
  RELEASE_PROJECT_ID,RELEASE_BRANCH,RELEASE_NEON_BRANCH,
  RELEASE_AUTH_URL,RELEASE_DATA_API_URL,RELEASE_ORIGIN,
} from "../lib/neon/production-release.ts";
import {createNeonDataApiClient} from "../lib/neon/data-api.ts";

const SHA="a1b2c3d4".repeat(5);
const USER="00000000-0000-4000-8000-000000000041";
const ROW="00000000-0000-4000-8000-000000000042";
const validProduction={
  VERCEL:"1",VERCEL_ENV:"production",NODE_ENV:"production",
  VERCEL_PROJECT_ID:RELEASE_PROJECT_ID,
  VERCEL_GIT_COMMIT_REF:RELEASE_BRANCH,
  VERCEL_GIT_COMMIT_SHA:SHA,
  NAOSLEDGE_PRODUCTION_ENABLED:"1",NAOSLEDGE_PRODUCTION_RELEASE_SHA:SHA,
  NAOSLEDGE_PRODUCTION_ORIGIN:RELEASE_ORIGIN,
  NEXT_PUBLIC_SITE_URL:RELEASE_ORIGIN,
  NAOSLEDGE_BACKEND:"neon",NEXT_PUBLIC_NAOSLEDGE_BACKEND:"neon",
  NAOSLEDGE_NEON_BRANCH_ID:RELEASE_NEON_BRANCH,
  NEON_AUTH_BASE_URL:RELEASE_AUTH_URL,NEON_DATA_API_URL:RELEASE_DATA_API_URL,
  NEON_AUTH_COOKIE_SECRET:"a-safe-synthetic-only-long-cookie-secret-for-tests",
};

const check=(environment,ownerRlsCount)=>
  observeM7ProductionOwnerWebReadiness({environment,ownerRlsCount});

test("M7 web readiness never queries Production from Sandbox, Preview or local mode",async()=>{
  for(const environment of [
    {},{VERCEL_ENV:"preview"},{VERCEL_ENV:"development"},
    {NAOSLEDGE_PRODUCTION_ENABLED:"0"},
  ]){
    let invoked=0;
    const result=await check(environment,async()=>{invoked++;throw Error("wrong branch");});
    assert.deepEqual(result,{state:"not-production"});
    assert.equal(invoked,0);
  }
});

test("M7 web readiness refuses a nonmatching release SHA/Neon endpoint before any query",async()=>{
  const bad=[
    {NAOSLEDGE_PRODUCTION_RELEASE_SHA:"b".repeat(40)},
    {VERCEL_GIT_COMMIT_SHA:"c".repeat(40)},
    {VERCEL_PROJECT_ID:"prj-unapproved"},
    {NAOSLEDGE_NEON_BRANCH_ID:"br-quiet-sunset-b4xx4pnx"},
    {NEON_DATA_API_URL:"https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1"},
    {NAOSLEDGE_VAULT_PREVIEW_ENABLED:"1"},
    {NAOSLEDGE_PRODUCTION_ENABLED:"0"},
  ];
  for(const diff of bad){
    let invoked=0;
    assert.deepEqual(await check({...validProduction,...diff},async()=>{
      invoked++;return {data:[],count:0,error:null};
    }),{state:"unavailable"});
    assert.equal(invoked,0);
  }
});

test("M7 web readiness accepts only exact Owner-scoped totals without creating transfer authority",async()=>{
  const zero=await check(validProduction,async()=>({data:[],count:0,error:null}));
  assert.deepEqual(zero,{
    state:"verified",remoteNotes:0,
    remoteFullInventoryRead:false,noteBodiesRead:false,
    comparisonPerformed:false,transferAllowed:false,baselineSaved:false,
  });
  const many=await check(validProduction,async()=>({
    data:[{id:ROW}],count:7,error:null,
  }));
  assert.equal(many.state,"verified");
  assert.equal(many.remoteNotes,7);
  assert.equal(many.remoteFullInventoryRead,false);
  assert.equal(many.transferAllowed,false);
  assert.equal(many.baselineSaved,false);
  assert.doesNotMatch(JSON.stringify(many),new RegExp(USER+"|"+ROW));
});

test("M7 web readiness rejects unverified, truncated and misleading count responses",async()=>{
  const responses=[
    {data:[],count:null,error:null},
    {data:[],count:undefined,error:null},
    {data:[],count:1,error:null},
    {data:[{id:ROW}],count:0,error:null},
    {data:[{id:ROW},{id:ROW}],count:2,error:null},
    {data:[{id:ROW,title:"private"}],count:1,error:null},
    {data:[{id:"unsafe-slug"}],count:1,error:null},
    {data:[null],count:1,error:null},
    {data:[{id:ROW}],count:NaN,error:null},
    {data:[{id:ROW}],count:-1,error:null},
    {data:[{id:ROW}],count:1.5,error:null},
    {data:[{id:ROW}],count:1_000_001,error:null},
    {data:null,count:0,error:null},
    {data:[],count:0,error:new Error("PRIVATE_BODY_MUST_NOT_LEAK")},
    {data:[],count:0,error:undefined},
  ];
  for(const item of responses){
    const x=await check(validProduction,async()=>item);
    assert.deepEqual(x,{state:"unavailable"});
    assert.doesNotMatch(JSON.stringify(x),/PRIVATE_BODY_MUST_NOT_LEAK|unsafe-slug/);
  }
  const raised=await check(validProduction,async()=>{
    throw new Error("PRIVATE_JWT_AND_BODY_MUST_NOT_LEAK");
  });
  assert.deepEqual(raised,{state:"unavailable"});
});

test("M7 website query shape uses actual PostgREST GET, exact count, one id, and member JWT",async()=>{
  const observed=[];
  const client=createNeonDataApiClient(RELEASE_DATA_API_URL,
    async()=> "synthetic.production.jwt",async(input,init)=>{
      const url=new URL(String(input));
      observed.push({url,method:init?.method,body:init?.body,
        jwt:new Headers(init?.headers).get("authorization"),
        prefer:new Headers(init?.headers).get("prefer")});
      return new Response(JSON.stringify([{id:ROW}]),{
        status:206,headers:{
          "content-type":"application/json",
          "content-range":"0-0/7",
        },
      });
    });
  const result=await check(validProduction,async()=>{
    const {data,count,error}=await client.from("knowledge_notes")
      .select("id",{count:"exact"})
      .eq("owner_id",USER)
      .limit(1);
    return {data,count,error};
  });
  assert.equal(observed.length,1);
  const req=observed[0];
  assert.equal(req.url.origin,new URL(RELEASE_DATA_API_URL).origin);
  assert.equal(req.url.pathname,"/neondb/rest/v1/knowledge_notes");
  assert.equal(req.url.searchParams.get("select"),"id");
  assert.equal(req.url.searchParams.get("owner_id"),"eq."+USER);
  assert.equal(req.url.searchParams.get("limit"),"1");
  assert.equal(req.method,"GET");
  assert.equal(req.prefer,"count=exact");
  assert.equal(req.body,undefined);
  assert.equal(req.jwt,"Bearer synthetic.production.jwt");
  assert.equal(result.state,"verified");
  assert.equal(result.remoteNotes,7);
  assert.equal(result.noteBodiesRead,false);
});

test("M7 web route preserves the existing verified Owner session boundary and never offers writes",async()=>{
  const page=await readFile(new URL("../app/vault/sync/page.tsx",import.meta.url),"utf8");
  const view=await readFile(new URL("../components/vault-manual-sync-review.tsx",import.meta.url),"utf8");
  const auth=page.indexOf("const context=await requireVault()");
  const readiness=page.indexOf("observeM7ProductionOwnerWebReadiness");
  const actual=page.lastIndexOf("await observeM7ProductionOwnerWebReadiness(");
  assert.ok(auth>=0&&actual>auth);
  assert.ok(readiness>=0);
  assert.match(page,/\.select\("id",\{count:"exact"\}\)/);
  assert.match(page,/\.eq\("owner_id",context\.user\.id\)/);
  assert.match(page,/\.limit\(1\)/);
  assert.match(page,/force-dynamic/);
  assert.match(view,/m7ProductionReadiness\?\.state==="verified"/);
  assert.match(view,/m7ProductionReadiness\?\.state==="unavailable"/);
  assert.match(view,/不會執行上傳、下載、覆寫、刪除/);
});
