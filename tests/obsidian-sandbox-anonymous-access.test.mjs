import test from "node:test";
import assert from "node:assert/strict";
import {
  verifySandboxAnonymousIsolation,
} from "../scripts/obsidian-sandbox-anonymous-access.ts";
import {NEON_SYNC_SANDBOX_BRANCH} from "../lib/obsidian-neon-sandbox-readonly.ts";

const token="sandbox.anonymous.signature";
const authResponse=()=>new Response(JSON.stringify({token}),{
  status:200,headers:{"content-type":"application/json"},
});

test("actual anonymous smoke only requests a sandbox JWT and 3 safe GETs",async()=>{
  const seen=[];
  const fetcher=async(url,opts)=>{
    seen.push({url,opts});
    assert.equal(opts.method,"GET");
    assert.equal(opts.redirect,"manual");
    assert.equal(opts.credentials,"omit");
    assert.equal(opts.body,undefined);
    if(url.endsWith("/token/anonymous")){
      assert.equal(opts.headers.Origin,"http://localhost:3000");
      return authResponse();
    }
    assert.ok(url.includes("ep-square-cloud-b45d18zl.apirest."));
    assert.equal(opts.headers.Authorization,"Bearer "+token);
    const suffix=new URL(url).pathname.split("/").at(-1);
    assert.ok(["knowledge_notes","knowledge_links","knowledge_publication_sources"].includes(suffix));
    return new Response(JSON.stringify({message:"SECRET_DATA_MUST_NOT_BE_READ"}),{
      status:403,headers:{"content-type":"application/json"},
    });
  };
  const p=await verifySandboxAnonymousIsolation({branchId:NEON_SYNC_SANDBOX_BRANCH,fetcher});
  assert.equal(seen.length,4);
  assert.deepEqual(p,{
    branchId:NEON_SYNC_SANDBOX_BRANCH,
    tablesChecked:3,allDenied:true,writeMethodsUsed:false,
  });
  assert.doesNotMatch(JSON.stringify(p),/SECRET_DATA|Bearer|signature/);
});

test("only the explicitly approved sandbox branch may be queried",async()=>{
  let calls=0;
  await assert.rejects(verifySandboxAnonymousIsolation({
    branchId:"br-aged-sound-b43h5r2c",fetcher:async()=>{calls++;return authResponse();},
  }),/approved Neon Sandbox/);
  assert.equal(calls,0);
});

test("unauthenticated/malformed auth responses are denied without exposing tokens",async()=>{
  for(const resp of [
    new Response("Bad",{status:403}),
    new Response("<html>login</html>",{status:200,headers:{"content-type":"text/html"}}),
    new Response(JSON.stringify({token:"fake"}),{status:200,headers:{"content-type":"application/json"}}),
    new Response(JSON.stringify({token:"SUPER_PRIVATE_SECRET"}),{status:200,headers:{"content-type":"application/json"}}),
  ]){
    await assert.rejects(verifySandboxAnonymousIsolation({
      branchId:NEON_SYNC_SANDBOX_BRANCH,fetcher:async()=>resp,
    }),err=>{
      assert.doesNotMatch(err.message,/SUPER_PRIVATE_SECRET/);
      return true;
    });
  }
});

test("anonymous 200 even with an empty list is an unsafe policy",async()=>{
  let calls=0;
  await assert.rejects(verifySandboxAnonymousIsolation({
    branchId:NEON_SYNC_SANDBOX_BRANCH,
    fetcher:async()=>{
      calls++;
      if(calls===1)return authResponse();
      return new Response("[]",{status:200,headers:{"content-type":"application/json"}});
    },
  }),/Anonymous access policy unsafe/);
  assert.equal(calls,2);
});

test("403, 401 and hidden-table 404 are all no-access outcomes",async()=>{
  let calls=0;
  const statuses=[401,403,404];
  const result=await verifySandboxAnonymousIsolation({
    branchId:NEON_SYNC_SANDBOX_BRANCH,
    fetcher:async()=>{
      if(calls++===0)return authResponse();
      return new Response(null,{status:statuses[calls-2]});
    },
  });
  assert.equal(result.allDenied,true);
  assert.equal(result.tablesChecked,3);
});

test("unexpected redirect during protected-table check fails closed",async()=>{
  let calls=0;
  await assert.rejects(verifySandboxAnonymousIsolation({
    branchId:NEON_SYNC_SANDBOX_BRANCH,
    fetcher:async()=>{
      if(calls++===0)return authResponse();
      return new Response(null,{status:302,headers:{
        location:"https://vercel.com/sso-api",
      }});
    },
  }),/Anonymous access policy unsafe/);
});
