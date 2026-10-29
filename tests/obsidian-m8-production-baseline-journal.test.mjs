import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {mkdtemp,open,readFile,readdir,rm,writeFile,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  adoptProductionM8EqualPairing,inspectProductionM8Baseline,
  recordVerifiedProductionM8Upload,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {serializeObsidianMarkdown} from "../lib/obsidian-markdown.ts";
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "../lib/neon/production-release.ts";

const SUB="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000042";
const ID="00000000-0000-4000-8000-000000000051";
const SLUG="production-equality-test";
const SHA=s=>createHash("sha256").update(s).digest("hex");
const jwt=(sub=SUB)=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".syntheticsignature";
const protector={
  seal:async key=>key.toString("base64"),
  unseal:async data=>Buffer.from(data,"base64"),
};
const row=(update="v1",ts="2026-10-29T03:00:00.000Z")=>({
  id:ID,slug:SLUG,title:"Synthetic equal note",
  summary:"do not publish",content_md:"# "+update+"\n",
  category:"test",tags:["safe"],learned_on:"2026-10-29",updated_at:ts,
});
const markdown=r=>serializeObsidianMarkdown({
  title:r.title,slug:r.slug,excerpt:r.summary,
  category:r.category,tags:r.tags,learned_on:r.learned_on,
  content_md:r.content_md,
});
const expected=r=>({slug:r.slug,sha256:SHA(markdown(r)),
  revision:SHA(r.id+":"+r.updated_at)});
const response=(data,range,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json",
    ...(range?{"content-range":range}:{})},
});
function remoteServer(initial=[],opts={}){
  let rows=initial.map(x=>({...x}));
  let requests=0, grants=0;
  const fetcher=async(uri,config)=>{
    requests++;
    const u=new URL(uri);
    assert.equal(u.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(config.method,"GET");
    assert.match(config.headers.Authorization,/^Bearer /);
    if(u.pathname.endsWith("/blog_admins")){
      grants++;
      const who=u.searchParams.get("user_id");
      if(opts.noOwner)return response([],"*/0");
      const sub=opts.otherOwner?OTHER:SUB;
      assert.equal(who,"eq."+sub);
      return response([{user_id:sub}],"0-0/1");
    }
    assert.ok(u.pathname.endsWith("/knowledge_notes"));
    assert.equal(u.searchParams.get("order"),"slug.asc,id.asc");
    const sorted=[...rows].sort((a,b)=>a.slug.localeCompare(b.slug,"en"));
    const offset=Number(u.searchParams.get("offset"));
    const page=sorted.slice(offset,offset+20);
    const range=page.length?
      offset+"-"+(offset+page.length-1)+"/"+sorted.length:"*/0";
    return response(page,range,offset+page.length<sorted.length?206:200);
  };
  return {
    fetcher,setRows:v=>{rows=v.map(x=>({...x}));},
    get grants(){return grants;},get requests(){return requests;},
  };
}
async function scratch(fn){
  const root=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const vault=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-vault-test-"));
  const options={
    testRoot:root,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault),
  };
  try{return await fn({root,vault,options});}
  finally{
    await rm(root,{recursive:true,force:true});
    await rm(vault,{recursive:true,force:true});
  }
}
const inspected=(fetcher,options,ownerJwt=jwt())=>
  inspectProductionM8Baseline({ownerJwt,fetcher,options});
const adopt=(fetcher,options,overrides={})=>
  adoptProductionM8EqualPairing({
    ownerJwt:jwt(),fetcher,options,
    typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
    ...overrides,
  });
const receipt=(current)=>({
  slug:SLUG,sha256:current.sha256,revision:current.revision,
  verifiedRemoteReadback:true,baselineSaved:false,
  automaticRetryAllowed:false,
});
const checkpoint=(fetcher,options,prior,next,more={})=>
  recordVerifiedProductionM8Upload({
    ownerJwt:jwt(),fetcher,options,
    receipt:receipt(next),
    beforeSha256:prior?.sha256??null,
    beforeRevision:prior?.revision??null,
    ...more,
  });

test("Production journal inspection of missing store is read-only and NOT paired",async()=>{
  await scratch(async({root,options})=>{
    const owner=remoteServer([]);
    const first=await inspected(owner.fetcher,options);
    assert.deepEqual(first,{
      paired:false,branch:RELEASE_NEON_BRANCH,recordCount:0,
      fingerprints:[],durableBaselineVerified:false,
      automaticTransfersEnabled:false,
    });
    assert.deepEqual(await readdir(root),[]);
    assert.ok(owner.grants>=1);
  });
});

test("explicit initial empty pairing is signed, persisted and recovered after restart",async()=>{
  await scratch(async({root,options})=>{
    const server=remoteServer([]);
    const result=await adopt(server.fetcher,options);
    assert.deepEqual(result,{
      paired:true,recordCount:1,autoSyncEnabled:false,
      initialNoteCount:0,
    });
    const restarted=await inspected(server.fetcher,options);
    assert.equal(restarted.paired,true);
    assert.equal(restarted.recordCount,1);
    assert.deepEqual(restarted.fingerprints,[]);
    assert.equal(restarted.durableBaselineVerified,true);
    assert.equal(restarted.automaticTransfersEnabled,false);
    assert.deepEqual((await readdir(root)).sort(),
      ["identity.dpapi","records"].sort());
  });
});

test("matching complete nonempty local and RLS inventories adopt canonical SHA and remote revision",async()=>{
  await scratch(async({vault,options})=>{
    const source=row();
    await writeFile(path.join(vault,SLUG+".md"),markdown(source));
    const server=remoteServer([source]);
    const a=await adopt(server.fetcher,options);
    assert.equal(a.initialNoteCount,1);
    const next=await inspected(server.fetcher,options);
    assert.deepEqual(next.fingerprints,[expected(source)]);
    assert.equal(next.recordCount,1);
  });
});

test("full 500-note Production pairing is durably signed even when the initial journal exceeds 64 KiB",async()=>{
  await scratch(async({root,vault,options})=>{
    const rows=Array.from({length:500},(_,i)=>({
      ...row(),
      id:"00000000-0000-4000-8000-"+String(i+1).padStart(12,"0"),
      slug:"note-"+String(i+1).padStart(4,"0")+"-"+ "a".repeat(90),
    }));
    // One note file per safe slug; no other root files or real Vault access.
    for(let offset=0;offset<rows.length;offset+=50){
      await Promise.all(rows.slice(offset,offset+50).map(item=>
        writeFile(path.join(vault,item.slug+".md"),markdown(item))));
    }
    const server=remoteServer(rows);
    const accepted=await adopt(server.fetcher,options);
    assert.equal(accepted.initialNoteCount,500);
    const saved=await stat(path.join(root,"records","000001.json"));
    assert.ok(saved.size>64_000);
    const resumed=await inspected(server.fetcher,options);
    assert.equal(resumed.fingerprints.length,500);
    assert.equal(resumed.recordCount,1);
    assert.equal(resumed.automaticTransfersEnabled,false);
  });
});

test("unequal local / remote hashes, unknown filenames or nested dirs cannot establish a pairing",async()=>{
  await scratch(async({root,vault,options})=>{
    const server=remoteServer([row()]);
    await assert.rejects(adopt(server.fetcher,options),/no automatic sync/);
    assert.deepEqual(await readdir(root),[]);
    await writeFile(path.join(vault,SLUG+".md"),"# diverged\n");
    await assert.rejects(adopt(server.fetcher,options),/no automatic sync/);
    assert.deepEqual(await readdir(root),[]);
    await writeFile(path.join(vault,SLUG+".md"),markdown(row()));
    await writeFile(path.join(vault,"中文.md"),"unknown");
    await assert.rejects(adopt(server.fetcher,options),/no automatic sync/);
  });
});

test("no typed human approval or RLS self-grant means no journal initialization",async()=>{
  await scratch(async({root,options})=>{
    const s=remoteServer([]);
    await assert.rejects(adopt(s.fetcher,options,{
      typedConfirmation:"APPROVE EVERYTHING",
    }));
    assert.equal(s.requests,0);
    await assert.rejects(adopt(remoteServer([],{noOwner:true}).fetcher,options));
    assert.deepEqual(await readdir(root),[]);
  });
});

test("duplicate initialization refuses without modifying signed records",async()=>{
  await scratch(async({root,options})=>{
    const s=remoteServer([]);
    await adopt(s.fetcher,options);
    const filename=path.join(root,"records","000001.json");
    const before=await readFile(filename);
    await assert.rejects(adopt(s.fetcher,options));
    assert.deepEqual(await readFile(filename),before);
    assert.equal((await inspected(s.fetcher,options)).recordCount,1);
  });
});

test("a complete initial pairing followed by verified Production upload creates a MAC-chained checkpoint",async()=>{
  await scratch(async({root,vault,options})=>{
    const first=row(),second=row("v2","2026-10-29T03:05:00.000Z");
    await writeFile(path.join(vault,SLUG+".md"),markdown(first));
    const s=remoteServer([first]);
    await adopt(s.fetcher,options);
    await writeFile(path.join(vault,SLUG+".md"),markdown(second));
    s.setRows([second]);
    const result=await checkpoint(s.fetcher,options,expected(first),expected(second));
    assert.deepEqual(result,{
      checkpointSaved:true,recordCount:2,autoSyncEnabled:false,
    });
    const loaded=await inspected(s.fetcher,options);
    assert.equal(loaded.paired,true);
    assert.equal(loaded.recordCount,2);
    assert.deepEqual(loaded.fingerprints,[expected(second)]);
    assert.deepEqual((await readdir(path.join(root,"records"))).sort(),
      ["000001.json","000002.json"]);
  });
});

test("new notes after explicitly approved empty pairing can be checkpointed without upsert",async()=>{
  await scratch(async({vault,options})=>{
    const s=remoteServer([]);
    await adopt(s.fetcher,options);
    const source=row();
    await writeFile(path.join(vault,SLUG+".md"),markdown(source));
    s.setRows([source]);
    const output=await checkpoint(s.fetcher,options,null,expected(source));
    assert.equal(output.recordCount,2);
    assert.equal((await inspected(s.fetcher,options)).fingerprints[0].slug,SLUG);
  });
});

test("wrong old revision, unverified receipt and stale local SHA all reject before checkpoint",async()=>{
  await scratch(async({root,vault,options})=>{
    const initial=row(),updated=row("v2","2026-10-29T03:05:00.000Z");
    await writeFile(path.join(vault,SLUG+".md"),markdown(initial));
    const s=remoteServer([initial]);
    await adopt(s.fetcher,options);
    await writeFile(path.join(vault,SLUG+".md"),markdown(updated));
    s.setRows([updated]);
    for(const change of [
      {beforeRevision:"f".repeat(64)},
      {receipt:{...receipt(expected(updated)),verifiedRemoteReadback:false}},
      {receipt:{...receipt(expected(updated)),sha256:"f".repeat(64)}},
      {receipt:{...receipt(expected(updated)),automaticRetryAllowed:true}},
    ]){
      await assert.rejects(checkpoint(s.fetcher,options,
        expected(initial),expected(updated),change));
    }
    assert.equal((await readdir(path.join(root,"records"))).length,1);
  });
});

test("a mismatched final cloud readback never advances Baseline even with a trusted receipt",async()=>{
  await scratch(async({root,vault,options})=>{
    const before=row();
    const expectedRow=row("v2","2026-10-29T03:05:00.000Z");
    await writeFile(path.join(vault,SLUG+".md"),markdown(before));
    const s=remoteServer([before]);
    await adopt(s.fetcher,options);
    await writeFile(path.join(vault,SLUG+".md"),markdown(expectedRow));
    // Remote still old after caller's claimed successful RPC.
    await assert.rejects(checkpoint(s.fetcher,options,
      expected(before),expected(expectedRow)));
    assert.equal((await readdir(path.join(root,"records"))).length,1);
  });
});

test("tampered MAC record and wrong owner cannot be treated as a valid Production journal",async()=>{
  await scratch(async({root,options})=>{
    const s=remoteServer([]);
    await adopt(s.fetcher,options);
    await assert.rejects(inspected(remoteServer([],{otherOwner:true}).fetcher,
      options,jwt(OTHER)),/no automatic sync/);
    const file=path.join(root,"records","000001.json");
    const raw=await readFile(file,"utf8");
    const swapped=JSON.parse(raw);
    swapped.mac="f".repeat(64);
    await writeFile(file,JSON.stringify(swapped));
    await assert.rejects(inspected(s.fetcher,options),/no automatic sync/);
  });
});

test("one incomplete journal record is not repaired or silently skipped",async()=>{
  await scratch(async({root,options})=>{
    const s=remoteServer([]);
    await adopt(s.fetcher,options);
    await writeFile(path.join(root,"records","000002.json"),"{broken");
    await assert.rejects(inspected(s.fetcher,options),/no automatic sync/);
    assert.ok((await stat(path.join(root,"records","000002.json"))).size>0);
  });
});

test("cross-process lock refuses competing checkpoint and abandoned lock remains for manual recovery",async()=>{
  await scratch(async({root,options})=>{
    const s=remoteServer([]);
    await adopt(s.fetcher,options);
    const lock=path.join(root,"journal.lock");
    const code=String.raw`const fs=require("fs");const file=process.argv[1];
const fd=fs.openSync(file,"wx",0o600);fs.writeSync(fd,"held");fs.fsyncSync(fd);
process.stdout.write("LOCKED\n");process.stdin.once("data",()=>{
fs.closeSync(fd);fs.unlinkSync(file);process.exit(0);
});`;
    const child=spawn(process.execPath,["-e",code,lock],{
      stdio:["pipe","pipe","pipe"],windowsHide:true,
    });
    try{
      const started=await Promise.race([
        new Promise((resolve,reject)=>{
          let s="";
          child.stdout.on("data",part=>{
            s+=part.toString("utf8");
            if(s.includes("LOCKED\n"))resolve(true);
          });
          child.on("error",reject);
          child.on("exit",()=>reject(Error("Child exited before lock acquired")));
        }),
        new Promise((_,reject)=>setTimeout(()=>reject(Error("Lock timeout")),4000)),
      ]);
      assert.equal(started,true);
      await assert.rejects(recordVerifiedProductionM8Upload({
        ownerJwt:jwt(),fetcher:s.fetcher,options,
        beforeSha256:null,beforeRevision:null,
        receipt:receipt(expected(row())),
      }),/no automatic sync/);
      assert.equal((await readdir(path.join(root,"records"))).length,1);
    }finally{
      child.stdin.write("release\n");
      await new Promise(resolve=>child.once("exit",resolve));
    }
    assert.equal((await inspected(s.fetcher,options)).recordCount,1);
    // Even an abandoned lock must never be taken over automatically.
    const h=await open(lock,"wx");
    try{
      await assert.rejects(inspected(s.fetcher,options),/no automatic sync/);
      assert.ok((await stat(lock)).isFile());
    }finally{await h.close();}
  });
});

test("Sandbox journal bytes and invalid OS-temp override paths cannot be accepted",async()=>{
  await scratch(async({root,options})=>{
    await assert.rejects(inspected(remoteServer([]).fetcher,{
      ...options,testRoot:"C:\\Naos\\Obsidian\\Naosledge",
    }));
    await assert.rejects(inspected(remoteServer([]).fetcher,{
      ...options,testProtector:undefined,
    }));
    const s=remoteServer([]);
    await adopt(s.fetcher,options);
    const envelope=path.join(root,"identity.dpapi");
    const bytes=JSON.parse(await readFile(envelope,"utf8"));
    bytes.format="naosledge.m5.dpapi-key.v1";
    await writeFile(envelope,JSON.stringify(bytes));
    await assert.rejects(inspected(s.fetcher,options),/no automatic sync/);
  });
});

test("no live route, Windows watcher or scheduler calls any M8 baseline write method",async()=>{
  const {readFile}=await import("node:fs/promises");
  const paths=[
    "../lib/obsidian-m8-readonly-host.ts",
    "../app/vault/sync/page.tsx",
    "../lib/obsidian-auto-sync-wakeup.ts",
  ];
  for(const item of paths){
    const code=await readFile(new URL(item,import.meta.url),"utf8");
    assert.doesNotMatch(code,/adoptProductionM8EqualPairing|recordVerifiedProductionM8Upload/);
  }
});
