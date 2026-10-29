import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile,rm,readdir,open}
  from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createM8EphemeralOwnerSource}
  from "../lib/obsidian-m8-owner-session-source.ts";
import {createM8WindowsReadOnlyAgent}
  from "../lib/obsidian-m8-windows-agent-controller.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {serializeObsidianMarkdown}
  from "../lib/obsidian-markdown.ts";
import {adoptProductionM8EqualPairing}
  from "../lib/obsidian-m8-production-baseline-journal.ts";
import {RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000099";
const tok=(sub=OWNER,delta=3600)=>{
  const now=Math.floor(Date.now()/1000);
  return "eyJhbGciOiJIUzI1NiJ9."+
    Buffer.from(JSON.stringify({sub,exp:now+delta}))
      .toString("base64url")+".syntheticsignature";
};
const protector={
  seal:async value=>value.toString("base64"),
  unseal:async raw=>Buffer.from(raw,"base64"),
};
const note={
  id:"00000000-0000-4000-8000-000000000077",
  slug:"local-one",title:"M8 P2 synthetic",
  summary:"local test only",content_md:"# Test note\n",
  category:"test",tags:[],learned_on:"2026-10-29",
  updated_at:"2026-10-29T03:00:00Z",
};
const markdown=serializeObsidianMarkdown({
  slug:note.slug,title:note.title,excerpt:note.summary,
  category:note.category,tags:note.tags,
  learned_on:note.learned_on,content_md:note.content_md,
});
const response=(payload,range)=>new Response(JSON.stringify(payload),{
  status:200,headers:{
    "content-type":"application/json","content-range":range,
  },
});
function fakeOwner(initial=[]){
  let records=initial.map(row=>({...row}));
  const methods=[],tokens=[];
  const fetcher=async(url,req)=>{
    const u=new URL(url);
    assert.equal(u.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(req.method,"GET");
    assert.equal(req.cache,"no-store");
    const auth=req.headers.Authorization;
    assert.match(auth,/^Bearer /);
    methods.push(req.method);
    tokens.push(auth.slice(7));
    if(u.pathname.endsWith("/blog_admins")){
      const expected="eq."+OWNER;
      if(u.searchParams.get("user_id")!==expected)
        return response([],"*/0");
      return response([{user_id:OWNER}],"0-0/1");
    }
    assert.ok(u.pathname.endsWith("/knowledge_notes"));
    const rows=records.slice(Number(u.searchParams.get("offset")||0),
      Number(u.searchParams.get("offset")||0)+20);
    return response(rows,rows.length?"0-"+(rows.length-1)+"/"+records.length:"*/0");
  };
  return {
    fetcher,
    get requestCount(){return methods.length;},
    get postCount(){return methods.filter(x=>x!=="GET").length;},
    get tokenRequests(){return tokens;},
    update:value=>{records=value.map(x=>({...x}));},
  };
}
async function scratch(fn){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-agent-test-"));
  const journal=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const journalOptions={
    testRoot:journal,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault),
  };
  try{return await fn({vault,journal,journalOptions});}
  finally{
    await rm(journal,{recursive:true,force:true});
    await rm(vault,{recursive:true,force:true});
  }
}
const waitFor=async(predicate,ms=8000)=>{
  const end=Date.now()+ms;
  while(Date.now()<end){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,35));
  }
  throw Error("M8 Agent test condition not reached");
};
const agentConfig=(vault,journalOptions,remote,getJwt=async()=>tok(),
  extra={})=>({
  requestFreshJwt:getJwt,
  testOnly:{root:vault,journal:journalOptions,
    fetcher:remote.fetcher,...extra},
});

test("token lease acquires new token each scan and does not cache or publish credentials",async()=>{
  let calls=0;
  const session=createM8EphemeralOwnerSource({
    requestFreshJwt:async()=>{calls++;return tok();},
  });
  const first=await session.acquire();
  const second=await session.acquire();
  assert.equal(first,second);
  assert.equal(calls,2,"provider must be called again, never cached");
  assert.deepEqual(session.status(),{
    ownerPinned:true,successfulAcquisitions:2,storedTokens:0,
    automaticTransfersEnabled:false,
  });
  assert.doesNotMatch(JSON.stringify(session.status()),/syntheticsignature|00000000|Bearer/);
});

test("near-expired, changed-owner and thrown credential provider always fail without exposing tokens",async()=>{
  const expiring=createM8EphemeralOwnerSource({
    requestFreshJwt:async()=>tok(OWNER,20),
  });
  await assert.rejects(expiring.acquire(),/Owner session/);
  assert.equal(expiring.status().successfulAcquisitions,0);
  let n=0;
  const switched=createM8EphemeralOwnerSource({
    requestFreshJwt:async()=>{n++;return tok(n===1?OWNER:OTHER);},
  });
  await switched.acquire();
  await assert.rejects(switched.acquire(),/invalid, expired or changed/);
  const broken=createM8EphemeralOwnerSource({
    requestFreshJwt:async()=>{throw Error("PRIVATE_JWT_MUST_NOT_LEAK");},
  });
  await assert.rejects(broken.acquire(),error=>{
    assert.doesNotMatch(error.message,/PRIVATE_JWT/);
    assert.match(error.message,/refresh unavailable/);
    return true;
  });
});

test("OS Temp local note + missing Production pairing stays initial-review, never uploads",async()=>{
  await scratch(async({vault,journalOptions})=>{
    const testFile=path.join(vault,note.slug+".md");
    await writeFile(testFile,markdown);
    const copy=await readFile(testFile);
    const remote=fakeOwner([]);
    let tokenCalls=0;
    const statuses=[];
    const agent=createM8WindowsReadOnlyAgent(agentConfig(
      vault,journalOptions,remote,async()=>{tokenCalls++;return tok();},
      {schemaReady:false},
    ));
    assert.equal(agent.status().state,"stopped");
    assert.equal(remote.requestCount,0);
    await agent.start();
    try{
      await waitFor(()=>agent.status().health==="success");
      const status=agent.status();
      assert.equal(status.state,"running");
      assert.equal(status.last.mode,"initial-review");
      assert.equal(status.last.localNotes,1);
      assert.equal(status.last.remoteNotes,0);
      assert.equal(status.last.manualReviews,1);
      assert.equal(status.automaticTransfersEnabled,false);
      assert.equal(status.automaticDeletionEnabled,false);
      assert.equal(status.realVaultWrites,0);
      assert.equal(status.remoteWrites,0);
      assert.equal(remote.postCount,0);
      assert.ok(tokenCalls>=1);
      assert.deepEqual(await readFile(testFile),copy);
    }finally{await agent.stop();}
    assert.equal(agent.status().state,"stopped");
    assert.deepEqual(await readdir(vault),[note.slug+".md"]);
    assert.equal(await readdir(journalOptions.testRoot).then(x=>x.length),0,
      "agent must not initialize an unapproved baseline");
  });
});

test("pause suspends local watcher and polling; resume reauthenticates and rescans",async()=>{
  await scratch(async({vault,journalOptions})=>{
    await writeFile(path.join(vault,"first.md"),"# First\n");
    const remote=fakeOwner([]);
    let credentials=0;
    const agent=createM8WindowsReadOnlyAgent(agentConfig(
      vault,journalOptions,remote,async()=>{credentials++;return tok();},
    ));
    await agent.start();
    try{
      await waitFor(()=>agent.status().health==="success");
      const initial=remote.requestCount;
      assert.ok(initial>=3);
      agent.pause();
      assert.equal(agent.status().state,"paused");
      await writeFile(path.join(vault,"second.md"),"# Second\n");
      await new Promise(resolve=>setTimeout(resolve,1050));
      assert.equal(remote.requestCount,initial);
      await agent.resume();
      await waitFor(()=>agent.status().last?.localNotes===2);
      assert.ok(credentials>=2,"fresh token provider called on resume");
      assert.equal(agent.status().last.remoteNotes,0);
      assert.equal(agent.status().automaticTransfersEnabled,false);
    }finally{await agent.stop();}
  });
});

test("second controller cannot start in a process with an existing lock; recovers after clean stop",async()=>{
  await scratch(async({vault,journalOptions})=>{
    const remote=fakeOwner([]);
    const a=createM8WindowsReadOnlyAgent(agentConfig(vault,journalOptions,remote));
    const b=createM8WindowsReadOnlyAgent(agentConfig(vault,journalOptions,remote));
    await a.start();
    try{
      await assert.rejects(b.start(),/unavailable/);
      assert.equal(b.status().state,"stopped");
      assert.equal(a.status().state,"running");
      assert.equal(remote.postCount,0);
    }finally{await a.stop();}
    await b.start();
    try{
      await waitFor(()=>b.status().health==="success");
      assert.equal(b.status().state,"running");
    }finally{await b.stop();}
  });
});

test("abandoned lock is never removed or recovered without a separate human action",async()=>{
  await scratch(async({vault,journalOptions})=>{
    const lock=path.join(vault,".m8-readonly-agent.lock");
    const h=await open(lock,"wx",0o600);
    try{
      await h.writeFile("stale lock");
      await h.sync();
      const remote=fakeOwner([]);
      const agent=createM8WindowsReadOnlyAgent(agentConfig(
        vault,journalOptions,remote,
      ));
      await assert.rejects(agent.start(),/unavailable/);
      assert.equal(remote.requestCount,0);
      assert.equal(await readFile(lock,"utf8"),"stale lock");
      assert.equal(agent.status().state,"stopped");
    }finally{await h.close();}
  });
});

test("paired signed M5 is consulted per scan, but P2 read-only agent never writes even with verified schema",async()=>{
  await scratch(async({vault,journalOptions})=>{
    await writeFile(path.join(vault,note.slug+".md"),markdown);
    const remote=fakeOwner([note]);
    const adopted=await adoptProductionM8EqualPairing({
      ownerJwt:tok(),
      typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
      fetcher:remote.fetcher,
      options:journalOptions,
    });
    assert.equal(adopted.initialNoteCount,1);
    const agent=createM8WindowsReadOnlyAgent(agentConfig(
      vault,journalOptions,remote,async()=>tok(),
      {schemaReady:true},
    ));
    await agent.start();
    try{
      await waitFor(()=>agent.status().health==="success");
      assert.equal(agent.status().last.mode,"ready-to-wire");
      assert.equal(agent.status().last.localNotes,1);
      assert.equal(agent.status().last.manualReviews,0);
      assert.equal(agent.status().automaticTransfersEnabled,false);
      const old=remote.requestCount;
      await writeFile(path.join(vault,note.slug+".md"),
        markdown.replace("Test note","Updated local-only"));
      await waitFor(()=>remote.requestCount>old,5000);
      await waitFor(()=>agent.status().last?.manualReviews===0);
      assert.equal(remote.postCount,0,"no live CAS or create RPC is called");
    }finally{await agent.stop();}
  });
});

test("expired or changed Owner tokens cannot trigger a remote write or leak auth secrets into status",async()=>{
  await scratch(async({vault,journalOptions})=>{
    const remote=fakeOwner([]);
    let i=0;
    const agent=createM8WindowsReadOnlyAgent(agentConfig(
      vault,journalOptions,remote,
      async()=>{i++;return i===1?tok():tok(OTHER);},
    ));
    await agent.start();
    try{
      await waitFor(()=>agent.status().health==="success");
      const previous=remote.requestCount;
      await writeFile(path.join(vault,"new.md"),"# wake\n");
      await waitFor(()=>agent.status().health==="error",6500);
      assert.equal(remote.requestCount,previous,
        "changed Owner fails before sending an RLS request");
      assert.equal(agent.status().last,null);
      assert.equal(agent.status().automaticTransfersEnabled,false);
      assert.doesNotMatch(JSON.stringify(agent.status()),/00000000|syntheticsignature/);
    }finally{await agent.stop();}
  });
});

test("controller refuses real Vault path passed as a fake testRoot",async()=>{
  const remote=fakeOwner([]);
  const agent=createM8WindowsReadOnlyAgent({
    requestFreshJwt:async()=>tok(),
    testOnly:{
      root:"C:\\Naos\\Obsidian\\Naosledge",
      journal:{
        testRoot:"C:\\Naos\\Obsidian\\Naosledge",
        testProtector:protector,
        testReadLocal:async()=>({
          fingerprints:[],unsupportedMarkdownFiles:0,otherFiles:0,
          directoriesNotScanned:0,autoApplyAllowed:false,
        }),
      },
      fetcher:remote.fetcher,
    },
  });
  await assert.rejects(agent.start(),/unavailable/);
  assert.equal(remote.requestCount,0);
});

test("P2 controller is read-only by construction and never starts itself",async()=>{
  const script=await readFile(new URL(
    "../lib/obsidian-m8-windows-agent-controller.ts",import.meta.url),"utf8");
  assert.doesNotMatch(script,/save_knowledge_note|update_knowledge_note_cas|\.rpc\(|\.insert\(|\.delete\(|writeFile\([^)]*md|setInterval\(/);
  assert.doesNotMatch(script,/scheduledTask|schtasks\.exe|pm2 start|Start-Service/);
});
