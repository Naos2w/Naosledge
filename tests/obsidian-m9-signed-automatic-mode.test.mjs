import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,writeFile,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  adoptProductionM8EqualPairing,inspectM9SignedAutoState,
  setM9SignedAutomaticMode,inspectProductionM8Baseline,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {serializeObsidianMarkdown}
  from "../lib/obsidian-markdown.ts";
import {RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000042";
const token=(sub=OWNER)=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".signedfake";
const protector={seal:async k=>k.toString("base64"),
  unseal:async x=>Buffer.from(x,"base64")};
const row={
  id:"00000000-0000-4000-8000-000000000068",
  slug:"signed-test",title:"M9 signed",
  summary:"synthetic",content_md:"# M9\n",category:"test",
  tags:[],learned_on:"2026-10-31",updated_at:"2026-10-31T04:00:00Z",
};
const md=serializeObsidianMarkdown({
  slug:row.slug,title:row.title,excerpt:row.summary,
  content_md:row.content_md,category:row.category,
  tags:row.tags,learned_on:row.learned_on,
});
const respond=(payload,range)=>new Response(JSON.stringify(payload),{
  headers:{"content-type":"application/json","content-range":range},
});
function fakeOwner(initial=[]){
  let notes=initial.map(n=>({...n}));
  let calls=0,post=0;
  const fetcher=async(uri,config)=>{
    calls++;
    const url=new URL(uri);
    assert.equal(url.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(config.method,"GET");
    const auth=config.headers.Authorization;
    assert.match(auth,/^Bearer /);
    const sub=JSON.parse(Buffer.from(auth.slice(7).split(".")[1],"base64url")).sub;
    if(url.pathname.endsWith("/blog_admins")){
      const match=sub===OWNER;
      return respond(match?[{user_id:OWNER}]:[],match?"0-0/1":"*/0");
    }
    assert.ok(url.pathname.endsWith("/knowledge_notes"));
    const offset=Number(url.searchParams.get("offset")||"0");
    const page=notes.slice(offset,offset+20);
    return respond(page,page.length?
      offset+"-"+(offset+page.length-1)+"/"+notes.length:"*/0");
  };
  return {fetcher,get calls(){return calls},get posts(){return post},
    replace:value=>{notes=value.map(n=>({...n}));}};
}
async function scratch(work){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const journal=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const pending=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-incoming-test-"));
  const options={testRoot:journal,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault)};
  try{return await work({vault,journal,pending,options});}
  finally{
    await rm(vault,{recursive:true,force:true});
    await rm(journal,{recursive:true,force:true});
    await rm(pending,{recursive:true,force:true});
  }
}
const enroll=(api,options)=>adoptProductionM8EqualPairing({
  ownerJwt:token(),fetcher:api.fetcher,options,
  typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
});
const change=(api,options,pending,enabled,more={})=>
  setM9SignedAutomaticMode({
    ownerJwt:token(),fetcher:api.fetcher,options,
    testIncomingRoot:pending,schemaReady:true,enabled,
    typedConfirmation:enabled?"ENABLE M9 PRODUCTION AUTO SYNC":
      "DISABLE M9 PRODUCTION AUTO SYNC",
    ...more,
  });
const inspect=(api,options,jwt=token())=>inspectM9SignedAutoState({
  ownerJwt:jwt,fetcher:api.fetcher,options,
});

test("no initial pairing means signed auto mode is OFF and no file is created",async()=>{
  await scratch(async({journal,pending,options})=>{
    const api=fakeOwner([]);
    const before=await inspect(api,options);
    assert.deepEqual(before,{
      paired:false,signedAutoEnabled:false,
      branch:"br-aged-sound-b43h5r2c",
      maxTransfersPerCycle:1,allowDeletion:false,recordCount:0,
      ownerRlsVerified:true,fingerprintCount:0,
    });
    await assert.rejects(change(api,options,pending,true));
    assert.deepEqual(await readdir(journal),[]);
    assert.equal(api.posts,0);
  });
});

test("explicit equal initial pairing can opt into one-note-per-cycle signed auto mode",async()=>{
  await scratch(async({vault,options,journal,pending})=>{
    await writeFile(path.join(vault,row.slug+".md"),md);
    const api=fakeOwner([row]);
    await enroll(api,options);
    assert.equal((await inspect(api,options)).signedAutoEnabled,false);
    const start=await change(api,options,pending,true);
    assert.deepEqual(start,{
      signedAutoEnabled:true,recordCount:2,automaticTransferExecuted:false,
    });
    const reopened=await inspect(api,options);
    assert.equal(reopened.signedAutoEnabled,true);
    assert.equal(reopened.recordCount,2);
    assert.equal(reopened.allowDeletion,false);
    assert.equal(reopened.maxTransfersPerCycle,1);
    assert.equal((await inspectProductionM8Baseline({
      ownerJwt:token(),fetcher:api.fetcher,options,
    })).fingerprints[0].sha256,
      createHash("sha256").update(md).digest("hex"));
    // Repeated ENABLE is refused rather than producing duplicate grants.
    await assert.rejects(change(api,options,pending,true));
    const stop=await change(api,options,pending,false);
    assert.equal(stop.signedAutoEnabled,false);
    assert.equal(stop.recordCount,3);
    assert.equal((await inspect(api,options)).signedAutoEnabled,false);
    await assert.rejects(change(api,options,pending,false));
    assert.deepEqual((await readdir(path.join(journal,"records"))).sort(),[
      "000001.json","000002.json","000003.json",
    ]);
    assert.equal(api.posts,0);
  });
});

test("local-only files, mismatched versions and unknown local coverage block AUTO enrollment",async()=>{
  await scratch(async({vault,options,pending})=>{
    const api=fakeOwner([]);
    await enroll(api,options);
    await writeFile(path.join(vault,row.slug+".md"),md);
    await assert.rejects(change(api,options,pending,true));
    await rm(path.join(vault,row.slug+".md"));
    await writeFile(path.join(vault,"中文.md"),"not approved");
    await assert.rejects(change(api,options,pending,true));
    await rm(path.join(vault,"中文.md"));
    api.replace([row]);
    await assert.rejects(change(api,options,pending,true));
    assert.equal((await inspect(api,options)).signedAutoEnabled,false);
  });
});

test("pending/unfinished Incoming intent blocks signed mode; wrong approval cannot enable",async()=>{
  await scratch(async({options,pending})=>{
    const api=fakeOwner([]);
    await enroll(api,options);
    await writeFile(path.join(pending,"unexpected-intent.json"),"pending");
    await assert.rejects(change(api,options,pending,true));
    await rm(path.join(pending,"unexpected-intent.json"));
    await assert.rejects(change(api,options,pending,true,{
      typedConfirmation:"ENABLE EVERYTHING",
    }));
    await assert.rejects(change(api,options,pending,true,{
      schemaReady:false,
    }));
    assert.equal((await inspect(api,options)).recordCount,1);
  });
});

test("signed mode is Owner bound; changed Owner and tampered HMAC record fail closed",async()=>{
  await scratch(async({journal,options,pending})=>{
    const api=fakeOwner([]);
    await enroll(api,options);
    await change(api,options,pending,true);
    await assert.rejects(inspect(api,options,token(OTHER)));
    const file=path.join(journal,"records","000002.json");
    const record=JSON.parse(await readFile(file,"utf8"));
    record.enabled=false;
    await writeFile(file,JSON.stringify(record));
    await assert.rejects(inspect(api,options));
  });
});

test("disable is possible after external local divergence, without adopting changed note",async()=>{
  await scratch(async({vault,options,pending})=>{
    const api=fakeOwner([]);
    await enroll(api,options);
    await change(api,options,pending,true);
    await writeFile(path.join(vault,row.slug+".md"),md);
    const result=await change(api,options,pending,false);
    assert.equal(result.signedAutoEnabled,false);
    assert.equal((await inspect(api,options)).signedAutoEnabled,false);
  });
});
