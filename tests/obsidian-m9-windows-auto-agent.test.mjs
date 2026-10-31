import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createM9WindowsAutoAgent}
  from "../lib/obsidian-m9-windows-auto-agent.ts";
import {
  adoptProductionM8EqualPairing,setM9SignedAutomaticMode,
  inspectProductionM8Baseline,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {serializeObsidianMarkdown}
  from "../lib/obsidian-markdown.ts";
import {RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000042";
const jwt=(owner=OWNER)=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({
    sub:owner,exp:Math.floor(Date.now()/1000)+3600,
  })).toString("base64url")+".synthetic";
const protector={seal:async bytes=>bytes.toString("base64"),
  unseal:async data=>Buffer.from(data,"base64")};
const note={
  slug:"agent-synthetic",title:"M9 Windows Agent",summary:"test only",
  content_md:"# Auto note\n\n[[safe-link]]",category:"test",
  tags:[],learned_on:"2026-10-31",
};
const bytes=serializeObsidianMarkdown({
  slug:note.slug,title:note.title,excerpt:note.summary,
  content_md:note.content_md,category:note.category,
  tags:note.tags,learned_on:note.learned_on,
});
const json=(rows,range)=>new Response(JSON.stringify(rows),{
  headers:{"content-type":"application/json","content-range":range},
});
function cloud(){
  let r=null,links=[],posts=0,reads=0,lose=false,hold=false;
  let releaseWrite=()=>{};
  const fetcher=async(uri,req)=>{
    const u=new URL(uri);
    assert.equal(u.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(req.credentials,"omit");
    const bearer=req.headers.Authorization;
    assert.match(bearer,/^Bearer /);
    const owner=JSON.parse(Buffer.from(bearer.slice(7).split(".")[1],
      "base64url").toString("utf8")).sub;
    if(req.method==="GET"){
      reads++;
      if(u.pathname.endsWith("/blog_admins")){
        const match=owner===OWNER;
        return json(match?[{user_id:OWNER}]:[],match?"0-0/1":"*/0");
      }
      if(u.pathname.endsWith("/knowledge_notes")){
        return json(r?[r]:[],r?"0-0/1":"*/0");
      }
      if(u.pathname.endsWith("/knowledge_links")){
        return json(links.map(target_key=>({target_key})),
          links.length?"0-"+(links.length-1)+"/"+links.length:"*/0");
      }
      throw Error("Unrecognized synthetic endpoint");
    }
    assert.equal(req.method,"POST");
    posts++;
    const b=JSON.parse(req.body);
    assert.ok(u.pathname.endsWith("/rpc/save_knowledge_note"));
    assert.equal(b.p_id,null);
    assert.equal(b.p_slug,note.slug);
    r={
      id:"00000000-0000-4000-8000-000000000055",
      slug:b.p_slug,title:b.p_title,summary:b.p_summary,
      content_md:b.p_content_md,category:b.p_category,tags:b.p_tags,
      learned_on:b.p_learned_on,updated_at:"2026-10-31T05:00:00Z",
    };
    links=[...b.p_links];
    if(hold){
      await new Promise(resolve=>{releaseWrite=resolve;});
      hold=false;
    }
    if(lose)throw Error("LOST_POST_RESPONSE");
    return json(r.id,null);
  };
  return {fetcher,get posts(){return posts},get reads(){return reads},
    get row(){return r},
    loseNext:()=>{lose=true},
    holdNext:()=>{hold=true},
    releaseWrite:()=>releaseWrite(),
  };
}
async function scratch(fn,{enroll=true}={}){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const pending=await mkdtemp(path.join(tmpdir(),"naosledge-m8-incoming-test-"));
  const backup=await mkdtemp(path.join(tmpdir(),"naosledge-m8-backups-test-"));
  const journal=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const options={testRoot:journal,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault)};
  const remote=cloud();
  const testOnly={
    vaultRoot:vault,privateRoot:pending,archiveRoot:backup,
    journalOptions:options,fetcher:remote.fetcher,
  };
  try{
    if(enroll){
      await adoptProductionM8EqualPairing({
        ownerJwt:jwt(),fetcher:remote.fetcher,options,
        typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
      });
      await setM9SignedAutomaticMode({
        ownerJwt:jwt(),fetcher:remote.fetcher,options,
        testIncomingRoot:pending,schemaReady:true,
        enabled:true,typedConfirmation:"ENABLE M9 PRODUCTION AUTO SYNC",
      });
    }
    return await fn({vault,pending,backup,journal,options,remote,testOnly});
  }finally{
    await rm(vault,{recursive:true,force:true});
    await rm(pending,{recursive:true,force:true});
    await rm(backup,{recursive:true,force:true});
    await rm(journal,{recursive:true,force:true});
  }
}
async function until(predicate,ms=11000){
  const limit=Date.now()+ms;
  while(Date.now()<limit){
    if(predicate())return;
    await new Promise(ok=>setTimeout(ok,35));
  }
  throw Error("M9 Agent did not reach expected status");
}
const agent=(f,opts={})=>createM9WindowsAutoAgent({
  requestFreshJwt:async()=>jwt(),
  verifyProductionSchema:async()=>true,
  testOnly:f.testOnly,...opts,
});

test("opted-in Windows watcher automatically uploads one new local note, then idles without duplicate POST",async()=>{
  await scratch(async f=>{
    let snapshots=0;
    const a=agent(f,{onCycle:()=>{snapshots++;}});
    assert.equal(f.remote.posts,0);
    assert.equal(a.status().state,"stopped");
    await a.start();
    try{
      await until(()=>a.status().last?.status==="idle");
      await writeFile(path.join(f.vault,note.slug+".md"),bytes);
      await until(()=>a.status().last?.status==="transferred");
      assert.equal(a.status().last.action,"upload-create");
      assert.equal(a.status().last.transferCount,1);
      assert.equal(f.remote.posts,1);
      assert.equal((await inspectProductionM8Baseline({
        ownerJwt:jwt(),fetcher:f.remote.fetcher,options:f.options,
      })).recordCount,3);
      assert.ok(snapshots>=2);
      assert.equal(a.status().tokenStored,false);
      assert.equal(a.status().automaticDeletionAllowed,false);
      assert.deepEqual(await readdir(f.vault),[
        ".m8-readonly-agent.lock",note.slug+".md",
      ].sort());
    }finally{await a.stop();}
    assert.deepEqual(await readdir(f.vault),[note.slug+".md"]);
    assert.equal(f.remote.posts,1);
  });
});

test("pause prevents transfer until explicit resume; resumes using fresh Owner JWT",async()=>{
  await scratch(async f=>{
    let tokenRequests=0;
    const a=agent(f,{
      requestFreshJwt:async()=>{tokenRequests++;return jwt();},
    });
    await a.start();
    try{
      await until(()=>a.status().last?.status==="idle");
      a.pause();
      assert.equal(a.status().state,"paused");
      const before=f.remote.reads;
      await writeFile(path.join(f.vault,note.slug+".md"),bytes);
      await new Promise(r=>setTimeout(r,1100));
      assert.equal(f.remote.posts,0);
      assert.equal(f.remote.reads,before);
      await a.resume();
      await until(()=>a.status().last?.status==="transferred");
      assert.ok(tokenRequests>=2);
      assert.equal(f.remote.posts,1);
    }finally{await a.stop();}
  });
});

test("single-instance lock blocks competing M9 Agent; clean stop releases it",async()=>{
  await scratch(async f=>{
    const a=agent(f),b=agent(f);
    await a.start();
    try{
      await assert.rejects(b.start(),/manual review/);
      assert.equal(a.status().state,"running");
      assert.equal(b.status().state,"stopped");
      assert.equal(f.remote.posts,0);
    }finally{await a.stop();}
    await b.start();
    try{await until(()=>b.status().last?.status==="idle");}
    finally{await b.stop();}
  });
});

test("lost POST response LATCHES faulted state; watcher never retries by itself",async()=>{
  await scratch(async f=>{
    const a=agent(f);
    await a.start();
    try{
      await until(()=>a.status().last?.status==="idle");
      f.remote.loseNext();
      await writeFile(path.join(f.vault,note.slug+".md"),bytes);
      await until(()=>a.status().state==="faulted");
      assert.equal(f.remote.posts,1);
      assert.equal(a.status().faults,1);
      await new Promise(r=>setTimeout(r,1300));
      assert.equal(f.remote.posts,1);
      assert.equal(a.status().last,null);
      assert.equal((await inspectProductionM8Baseline({
        ownerJwt:jwt(),fetcher:f.remote.fetcher,options:f.options,
      })).recordCount,2);
    }finally{await a.stop();}
    const entries=await readdir(f.vault);
    assert.ok(entries.includes(".m9-fault-review-required"));
    assert.ok(!entries.includes(".m8-readonly-agent.lock"),
      "Read-only M8 inspection must remain possible");
    await assert.rejects(a.start(),/manual review/);
    const another=agent(f);
    await assert.rejects(another.start(),/manual review/,
      "A different process must not bypass the durable fault latch");
    assert.equal(f.remote.posts,1);
  });
});

test("stop drains a pending POST and leaves a durable review latch",async()=>{
  await scratch(async f=>{
    const a=agent(f);
    await a.start();
    await until(()=>a.status().last?.status==="idle");
    f.remote.holdNext();
    await writeFile(path.join(f.vault,note.slug+".md"),bytes);
    await until(()=>f.remote.posts===1);
    let stopped=false;
    const shuttingDown=a.stop().finally(()=>{stopped=true;});
    try{
      await new Promise(resolve=>setTimeout(resolve,80));
      assert.equal(stopped,false,
        "stop must not release the writer lock before the pending POST settles");
      assert.ok((await readdir(f.vault)).includes(".m8-readonly-agent.lock"));
    }finally{
      f.remote.releaseWrite();
      await shuttingDown;
    }
    assert.ok((await readdir(f.vault)).includes(".m9-fault-review-required"));
    assert.equal(f.remote.posts,1);
    await assert.rejects(a.start(),/manual review/);
  });
});

test("without signed initial pairing the agent never uploads an existing local note",async()=>{
  await scratch(async f=>{
    await writeFile(path.join(f.vault,note.slug+".md"),bytes);
    const a=agent(f);
    await a.start();
    try{
      await until(()=>a.status().last?.status==="unpaired");
      assert.equal(f.remote.posts,0);
      assert.equal(a.status().last.transferCount,0);
    }finally{await a.stop();}
  },{enroll:false});
});

test("unverified SQL schema readiness prevents automatic transfer",async()=>{
  await scratch(async f=>{
    await writeFile(path.join(f.vault,note.slug+".md"),bytes);
    const a=agent(f,{verifyProductionSchema:async()=>false});
    await a.start();
    try{
      await until(()=>a.status().last?.status==="schema-not-ready");
      assert.equal(f.remote.posts,0);
    }finally{await a.stop();}
  });
});

test("identity switch after startup causes fault, without leaking token or triggering POST",async()=>{
  await scratch(async f=>{
    let counter=0;
    const a=agent(f,{
      requestFreshJwt:async()=>jwt(++counter===1?OWNER:OTHER),
    });
    await a.start();
    try{
      await until(()=>a.status().last?.status==="idle");
      await writeFile(path.join(f.vault,note.slug+".md"),bytes);
      await until(()=>a.status().state==="faulted");
      assert.equal(f.remote.posts,0);
      assert.equal(a.status().tokenStored,false);
      assert.doesNotMatch(JSON.stringify(a.status()),/00000000|synthetic/);
    }finally{await a.stop();}
  });
});

test("auto Agent is not imported by site routes; no Windows Service installation",async()=>{
  const {readFile}=await import("node:fs/promises");
  const [website,entry,agentSource]=await Promise.all([
    readFile(new URL("../app/vault/sync/page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../scripts/obsidian-m8-windows-readonly-agent.ts",import.meta.url),"utf8"),
    readFile(new URL("../lib/obsidian-m9-windows-auto-agent.ts",import.meta.url),"utf8"),
  ]);
  assert.doesNotMatch(website,/createM9WindowsAutoAgent|runM9SignedAutoCycle/);
  assert.doesNotMatch(entry,/createM9WindowsAutoAgent|runM9SignedAutoCycle/);
  assert.doesNotMatch(agentSource,/schtasks|Start-Service|pm2 start/);
});
