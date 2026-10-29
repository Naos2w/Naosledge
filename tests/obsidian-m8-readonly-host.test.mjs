import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createM8ReadOnlySyncHost} from "../lib/obsidian-m8-readonly-host.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const jwt="eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({
    sub:SUB,exp:Math.floor(Date.now()/1000)+3600,
  })).toString("base64url")+".syntheticsignature";
const trust=(enabled=false)=>({
  initialPairingApproved:enabled,durableBaselineVerified:enabled,
  ownerSessionFresh:true,productionSchemaReady:true,
});
const reply=(value,range)=>
  new Response(JSON.stringify(value),{status:200,headers:{
    "content-type":"application/json","content-range":range,
  }});
async function withRoot(fn){
  const folder=await mkdtemp(path.join(tmpdir(),"naosledge-m8-host-"));
  try{return await fn(folder);}finally{await rm(folder,{recursive:true,force:true});}
}
async function waitFor(predicate,ms=7000){
  const until=Date.now()+ms;
  while(Date.now()<until){
    if(predicate())return;
    await new Promise(resolve=>setTimeout(resolve,35));
  }
  throw Error("Read-only host test condition not reached");
}
function mockRemote(note){
  let calls=0;
  const fetcher=async(uri,options)=>{
    calls++;
    assert.equal(options.method,"GET");
    const u=new URL(uri);
    if(u.pathname.endsWith("/blog_admins"))
      return reply([{user_id:SUB}],"0-0/1");
    assert.ok(u.pathname.endsWith("/knowledge_notes"));
    assert.equal(u.searchParams.get("select"),
      "id,slug,title,summary,content_md,category,tags,learned_on,updated_at");
    return note?reply([note],"0-0/1"):reply([],"*/0");
  };
  return {fetcher,get count(){return calls;}};
}

test("full read-only flow: real filesystem event wakes 800ms scheduler and rechecks local/Production RLS",async()=>{
  await withRoot(async root=>{
    const first=path.join(root,"first-note.md");
    await writeFile(first,"# Local synthetic only\n");
    const original=await readFile(first);
    const seen=[],remote=mockRemote();
    let jwtRequests=0,pairingRequests=0;
    const host=createM8ReadOnlySyncHost({
      root,fetcher:remote.fetcher,
      getOwnerJwt:async()=>{jwtRequests++;return jwt;},
      loadPairing:async()=>{pairingRequests++;return {
        baseline:[],trust:trust(false),
      };},
      onStatus:(summary,trigger)=>seen.push({summary,trigger}),
    });
    assert.equal(host.status().running,false);
    assert.equal(remote.count,0,"module import must not poll Neon");
    assert.equal(seen.length,0);
    await host.start();
    try{
      await waitFor(()=>seen.length>=1);
      assert.equal(seen[0].trigger,"startup");
      assert.equal(seen[0].summary.mode,"initial-review");
      assert.equal(seen[0].summary.localNotes,1);
      assert.equal(seen[0].summary.remoteNotes,0);
      assert.equal(seen[0].summary.automaticTransfersEnabled,false);
      assert.equal(host.status().running,true);
      const beforeCalls=remote.count;
      await writeFile(path.join(root,"second-note.md"),"A second disposable note");
      await waitFor(()=>seen.some(s=>s.summary.localNotes===2),7000);
      assert.ok(remote.count>beforeCalls,"watcher must wake a new Owner-RLS read");
      assert.ok(jwtRequests>=2&&pairingRequests>=2);
      assert.deepEqual(await readFile(first),original);
      assert.equal(host.status().last.localNotes,2);
      assert.equal(host.status().last.remoteWrites,0);
      assert.equal(host.status().last.localWrites,0);
    }finally{host.stop();}
    assert.equal(host.status().running,false);
  });
});

test("a confirmed pairing with identical Production and local Markdown is still read-only",async()=>{
  await withRoot(async root=>{
    const note={
      id:"00000000-0000-4000-8000-000000000101",
      slug:"same-note",title:"Same note",summary:"matching",
      category:"test",tags:[],learned_on:"2026-10-29",
      content_md:"# Same\n",updated_at:"2026-10-29T03:00:00Z",
    };
    const md=serializeObsidianMarkdown({
      slug:note.slug,title:note.title,excerpt:note.summary,
      category:note.category,tags:note.tags,
      learned_on:note.learned_on,content_md:note.content_md,
    });
    const sha=createHash("sha256").update(md).digest("hex");
    const revision=createHash("sha256").update(
      note.id+":"+note.updated_at).digest("hex");
    await writeFile(path.join(root,"same-note.md"),md);
    const result=mockRemote(note),seen=[];
    const host=createM8ReadOnlySyncHost({
      root,fetcher:result.fetcher,
      getOwnerJwt:async()=>jwt,
      loadPairing:async()=>({
        baseline:[{slug:"same-note",sha256:sha,revision}],
        trust:trust(true),
      }),
      onStatus:status=>seen.push(status),
    });
    await host.start();
    try{
      await waitFor(()=>seen.length===1);
      assert.equal(seen[0].mode,"ready-to-wire");
      assert.equal(seen[0].localNotes,1);
      assert.equal(seen[0].remoteNotes,1);
      assert.equal(seen[0].manualReviews,0);
      assert.equal(seen[0].automaticTransfersEnabled,false);
      assert.equal(result.count,2);
    }finally{host.stop();}
  });
});

test("missing signed Owner JWT retries safely and exposes no sensitive error",async()=>{
  await withRoot(async root=>{
    let attempted=0, remoteCalls=0;
    const host=createM8ReadOnlySyncHost({
      root,
      getOwnerJwt:async()=>{attempted++;return "synthetic.secret.invalid";},
      loadPairing:async()=>({baseline:[],trust:trust()}),
      fetcher:async()=>{remoteCalls++;throw Error("Unexpected remote call");},
    });
    await host.start();
    try{
      await waitFor(()=>host.status().health==="error");
      assert.equal(attempted,1);
      assert.equal(remoteCalls,0);
      assert.equal(host.status().last,null);
      assert.equal(host.status().automaticTransfersEnabled,false);
      assert.doesNotMatch(JSON.stringify(host.status()),/synthetic.secret.invalid/);
    }finally{host.stop();}
  });
});

test("missing Windows folder rejects start before JWT or remote access",async()=>{
  let calls=0;
  const host=createM8ReadOnlySyncHost({
    root:path.join(tmpdir(),"no-such-m8-test-vault-987654321"),
    getOwnerJwt:async()=>{calls++;return jwt;},
    loadPairing:async()=>{calls++;return {baseline:[],trust:trust()};},
  });
  await assert.rejects(host.start());
  assert.equal(calls,0);
  assert.equal(host.status().running,false);
});

test("read-only host exposes no transfer/cas/write method and never stores tokens",async()=>{
  const code=await import("node:fs/promises").then(fs=>fs.readFile(
    new URL("../lib/obsidian-m8-readonly-host.ts",import.meta.url),"utf8"));
  assert.doesNotMatch(code,/save_knowledge_note|update_knowledge_note_cas|\.rpc\(|\.insert\(|\.delete\(|\.update\(|writeFile\(|unlink\(|rename\(/);
});
