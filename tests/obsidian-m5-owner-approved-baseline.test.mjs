/**
 * M5 real OS-filesystem persistence, HMAC chain, restart, manual source checks.
 * Fake RLS readers are injected ONLY for an isolated OS-temp workspace.
 * Live CLI exclusively uses approved MSI Vault + pinned Neon Owner-RLS GET.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes} from "node:crypto";
import {link,mkdtemp,readFile,readdir,rm,unlink,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import path from "node:path";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {
  adoptM5CurrentEquality,inspectM5OwnerApprovedBaseline,
  assertM5ApprovedBaselineInvocation,windowsM5KeyProtector,
} from "../lib/obsidian-m5-owner-baseline-journal.ts";
import {
  M5_ADOPT,M5_INSPECT,readM5ApprovedBaselineRequest,
} from "../scripts/obsidian-m5-owner-baseline.ts";

const OWNER="00000000-0000-4000-8000-000000000079";
const OTHER="00000000-0000-4000-8000-000000000080";
const JWT=owner=>"header."+Buffer.from(JSON.stringify({sub:owner})).toString("base64url")+".signature";
const sha=value=>createHash("sha256").update(value).digest("hex");
const noteA={slug:"adopted-one",sha256:sha("safe common A"),revision:sha("rev a")};
const noteB={slug:"adopted-two",sha256:sha("safe common B"),revision:sha("rev b")};
const protector={
  // Synthetic protector for CI only. The real store uses Windows DPAPI!
  seal:async key=>Buffer.from("synthetic:"+key.toString("base64")).toString("base64"),
  unseal:async blob=>{
    const s=Buffer.from(blob,"base64").toString("utf8");
    if(!s.startsWith("synthetic:"))throw Error("synthetic key invalid");
    return Buffer.from(s.slice("synthetic:".length),"base64");
  },
};
async function withRoot(fn){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m5-owner-baseline-test-"));
  try{return await fn(root);}finally{await rm(root,{recursive:true,force:true});}
}
function fixture(root,owner=OWNER,initial=[noteA]){
  let local=initial.map(({slug,sha256})=>({slug,sha256}));
  let remote=initial.map(({slug,sha256,revision})=>({slug,sha256,revision}));
  let calls=0;
  let afterRead=null;
  const readPreview=async({sandboxOwnerJwt,baseline})=>{
    assert.equal(sandboxOwnerJwt,JWT(owner));
    calls++;
    if(afterRead)afterRead(calls);
    return previewManualObsidianSync({
      baseline,
      readLocal:async()=>({
        fingerprints:local.map(x=>({...x})),unsupportedMarkdownFiles:0,
        directoriesNotScanned:0,otherFiles:0,autoApplyAllowed:false,
      }),
      readRemote:async()=>({
        fingerprints:remote.map(x=>({...x})),numberOfNotes:remote.length,
        sandboxOnly:true,rlsEnforcedByDataApi:true,
        writeEnabled:false,fullInventory:true,
      }),
    });
  };
  return {
    options:{rootDir:root,protector,readPreview},
    get calls(){return calls;},
    setAfterRead(fn){afterRead=fn;},
    setLocal(values){local=values;},
    setRemote(values){remote=values;},
  };
}
const adopt=(item,owner=OWNER)=>({
  sandboxOwnerJwt:JWT(owner),slug:item.slug,sha256:item.sha256,
  remoteRevision:item.revision,
  typedConfirmation:"ADOPT M5 SANDBOX "+item.slug+" "+item.sha256.slice(0,12),
});

test("M5 explicitly adopts a current equal pair, persists authenticated chain and reloads after restart",async()=>{
  await withRoot(async root=>{
    const f=fixture(root,OWNER,[noteA,noteB]);
    const first=await adoptM5CurrentEquality(adopt(noteA),f.options);
    assert.deepEqual(first,{
      baselineSaved:true,entryCount:1,action:"manual-adopt-current-equality",
      transferConfirmed:false,autoApplyAllowed:false,deleteAllowed:false,
    });
    assert.equal(f.calls,2);
    assert.deepEqual((await readdir(path.join(root,"records"))),["000001.json"]);
    const envelope=await readFile(path.join(root,"identity.dpapi"),"utf8");
    assert.match(envelope,/naosledge.m5.dpapi-key.v1/);
    assert.equal(envelope.includes(JWT(OWNER)),false);
    assert.equal(envelope.includes(noteA.sha256),false);
    const second=await adoptM5CurrentEquality(adopt(noteB),f.options);
    assert.equal(second.entryCount,2);
    assert.deepEqual((await readdir(path.join(root,"records"))).sort(),[
      "000001.json","000002.json",
    ]);
    const report=await inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },f.options);
    assert.deepEqual(report,{
      baselineCount:2,manualReviewCount:0,conflicts:0,
      possibleDeletionsNeverApplied:0,
      loadedFromAuthenticatedJournal:true,readOnly:true,autoApplyAllowed:false,
      transferConfirmed:false,deleteAllowed:false,
    });
    assert.equal(f.calls,5);
    await assert.rejects(adoptM5CurrentEquality(adopt(noteA),f.options),
      /already adopted/);

    // Fresh Node process without any in-memory prior baseline.
    const importer=new URL("../lib/obsidian-m5-owner-baseline-journal.ts",import.meta.url).href;
    const planner=new URL("../lib/obsidian-manual-sync-review.ts",import.meta.url).href;
    const source=[
      "import {readFileSync} from 'node:fs';",
      "import {inspectM5OwnerApprovedBaseline} from "+JSON.stringify(importer)+";",
      "import {previewManualObsidianSync} from "+JSON.stringify(planner)+";",
      "const x=JSON.parse(readFileSync(0,'utf8'));",
      "const protector={seal:async b=>Buffer.from('synthetic:'+b.toString('base64')).toString('base64'),",
      "unseal:async b=>Buffer.from(Buffer.from(b,'base64').toString('utf8').slice(10),'base64')};",
      "const readPreview=({baseline})=>previewManualObsidianSync({baseline,",
      "readLocal:async()=>({fingerprints:x.local,unsupportedMarkdownFiles:0,otherFiles:0,",
      "directoriesNotScanned:0,autoApplyAllowed:false}),",
      "readRemote:async()=>({fingerprints:x.remote,numberOfNotes:x.remote.length,",
      "sandboxOnly:true,rlsEnforcedByDataApi:true,writeEnabled:false,fullInventory:true})});",
      "const output=await inspectM5OwnerApprovedBaseline({sandboxOwnerJwt:x.jwt},",
      "{rootDir:x.root,protector,readPreview});",
      "process.stdout.write(JSON.stringify(output));",
    ].join("\n");
    const child=spawnSync(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON","--input-type=module","-e",source,
    ],{input:JSON.stringify({root,jwt:JWT(OWNER),
      local:[noteA,noteB].map(({slug,sha256})=>({slug,sha256})),
      remote:[noteA,noteB]}),
      encoding:"utf8",timeout:15000});
    assert.equal(child.status,0,child.stderr);
    assert.deepEqual(JSON.parse(child.stdout),report);
  });
});

test("M5 preserved baseline classifies later local edits without rewriting a checkpoint",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    await adoptM5CurrentEquality(adopt(noteA),f.options);
    const files=await readdir(path.join(root,"records"));
    f.setLocal([{slug:noteA.slug,sha256:sha("a newer user edit")}]);
    const report=await inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },f.options);
    assert.equal(report.manualReviewCount,1);
    assert.equal(report.conflicts,0);
    assert.deepEqual(await readdir(path.join(root,"records")),files,
      "subsequent edits must not overwrite previous signed baseline");
  });
});

test("M5 restored Baseline never treats both missing copies as permission to delete",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    await adoptM5CurrentEquality(adopt(noteA),f.options);
    f.setLocal([]);f.setRemote([]);
    const state=await inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },f.options);
    assert.equal(state.baselineCount,1);
    assert.equal(state.manualReviewCount,0);
    assert.equal(state.possibleDeletionsNeverApplied,1);
    assert.equal(state.deleteAllowed,false);
    assert.equal(state.autoApplyAllowed,false);
    assert.deepEqual(await readdir(path.join(root,"records")),["000001.json"]);
  });
});

test("M5 rejects source drift during the second live preview, without writing evidence",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    f.setAfterRead(n=>{
      if(n===2)f.setRemote([{...noteA,revision:sha("concurrent remote")}]);
    });
    await assert.rejects(adoptM5CurrentEquality(adopt(noteA),f.options),
      /source changed before adoption/);
    assert.deepEqual(await readdir(root),[],
      "no DPAPI key or journal is created when a source changes");
  });
});

test("M5 rejects altered event bytes, missing history and owner-switch without any source reading",async()=>{
  await withRoot(async root=>{
    const f=fixture(root,OWNER,[noteA,noteB]);
    await adoptM5CurrentEquality(adopt(noteA),f.options);
    await adoptM5CurrentEquality(adopt(noteB),f.options);
    const record=path.join(root,"records","000001.json");
    const stored=await readFile(record,"utf8");
    const forged=JSON.parse(stored);
    forged.sha256="f".repeat(64);
    await writeFile(record,JSON.stringify(forged));
    const calls=f.calls;
    await assert.rejects(inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },f.options),/tampered or ambiguous journal/);
    assert.equal(f.calls,calls,"forged evidence must fail before remote calls");
    await writeFile(record,stored);
    await unlink(record);
    await assert.rejects(inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },f.options),/missing journal sequence/);
    await writeFile(record,stored);
    await assert.rejects(inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OTHER),
    },{...f.options,
      readPreview:async()=>{throw Error("should not call Owner GET");},
    }),/tampered or ambiguous journal/);
  });
});

test("M5 refuses hardlinked records, ambiguous files and a missing DPAPI identity",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    await adoptM5CurrentEquality(adopt(noteA),f.options);
    const record=path.join(root,"records","000001.json");
    const outside=path.join(tmpdir(),"naosledge-m5-hardlink-"+randomBytes(10).toString("hex"));
    try{
      await link(record,outside);
      await assert.rejects(inspectM5OwnerApprovedBaseline({
        sandboxOwnerJwt:JWT(OWNER),
      },f.options),/unsafe baseline evidence/);
    }finally{await unlink(outside).catch(()=>{});}
    await writeFile(path.join(root,"records","untrusted.txt"),"x");
    await assert.rejects(inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },f.options),/unexpected persistent journal/);
    await unlink(path.join(root,"records","untrusted.txt"));
    await unlink(path.join(root,"identity.dpapi"));
    await assert.rejects(inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },f.options),/no protected identity key/);
  });
});

test("M5 refuses wrong approval, duplicate consent and malformed or unmatched versions",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    for(const invalid of [
      {...adopt(noteA),typedConfirmation:"ADOPT M5 SANDBOX "+noteA.slug},
      {...adopt(noteA),sha256:"0".repeat(64)},
      {...adopt(noteA),remoteRevision:null},
      {...adopt(noteA),slug:"../vault"},
      {...adopt(noteA),sandboxOwnerJwt:"not.a.jwt"},
    ])await assert.rejects(adoptM5CurrentEquality(invalid,f.options));
    assert.deepEqual(await readdir(root),[],
      "bad explicit approval must not create key/journal");
  });
});

test("M5 does not import an approved baseline when local inventory coverage becomes incomplete",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    await adoptM5CurrentEquality(adopt(noteA),f.options);
    const calls=f.calls;
    const incomplete=async({baseline})=>previewManualObsidianSync({
      baseline,
      readLocal:async()=>({fingerprints:[{slug:noteA.slug,sha256:noteA.sha256}],
        unsupportedMarkdownFiles:0,otherFiles:0,directoriesNotScanned:1,
        autoApplyAllowed:false}),
      readRemote:async()=>({fingerprints:[noteA],numberOfNotes:1,
        sandboxOnly:true,rlsEnforcedByDataApi:true,writeEnabled:false,
        fullInventory:true}),
    });
    await assert.rejects(inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },{...f.options,readPreview:incomplete}),/fresh complete/);
    assert.equal(f.calls,calls);
    assert.deepEqual(await readdir(path.join(root,"records")),["000001.json"]);
  });
});

test("M5 prevents stale lock reuse, has no automatic retry and keeps originals untouched",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    const lock=path.join(root,"journal.lock");
    await writeFile(lock,"not-this-session");
    await assert.rejects(adoptM5CurrentEquality(adopt(noteA),f.options),
      /another baseline operation is active/);
    assert.equal(await readFile(lock,"utf8"),"not-this-session");
    assert.equal((await readdir(root)).length,1);
    await unlink(lock);
    const adopted=await adoptM5CurrentEquality(adopt(noteA),f.options);
    assert.equal(adopted.baselineSaved,true);
    assert.equal(adopted.autoApplyAllowed,false);
    assert.equal(adopted.deleteAllowed,false);
    assert.equal(adopted.transferConfirmed,false);
  });
});

test("M5 refuses revoked Owner reader and never downgrades to its old local receipt",async()=>{
  await withRoot(async root=>{
    const f=fixture(root);
    await adoptM5CurrentEquality(adopt(noteA),f.options);
    const unavailable=async()=>{throw Error("remote Owner RLS grant revoked");};
    const before=await readdir(path.join(root,"records"));
    await assert.rejects(inspectM5OwnerApprovedBaseline({
      sandboxOwnerJwt:JWT(OWNER),
    },{...f.options,readPreview:unavailable}),/RLS grant revoked/);
    assert.deepEqual(await readdir(path.join(root,"records")),before);
  });
});

test("M5 CLI only permits MSI manual private stdin and exact fields",async()=>{
  assert.doesNotThrow(()=>assertM5ApprovedBaselineInvocation("win32","MSI",[
    M5_ADOPT,
  ],false));
  assert.doesNotThrow(()=>assertM5ApprovedBaselineInvocation("win32","MSI",[
    M5_INSPECT,
  ],false));
  for(const argv of [
    ["linux","MSI",[M5_ADOPT],false],
    ["win32","OTHER",[M5_ADOPT],false],
    ["win32","MSI",[M5_ADOPT],true],
    ["win32","MSI",[],false],
    ["win32","MSI",[M5_INSPECT,"C:\\OtherVault"],false],
  ])assert.throws(()=>assertM5ApprovedBaselineInvocation(...argv),/MSI-only/);
  const good=adopt(noteA);
  assert.deepEqual(await readM5ApprovedBaselineRequest([
    JSON.stringify(good),
  ],M5_ADOPT),good);
  for(const bad of [
    {...good,extra:"no"},
    {...good,typedConfirmation:"not approved"},
    {...good,sha256:"a"},
  ])await assert.rejects(readM5ApprovedBaselineRequest([
    JSON.stringify(bad),
  ],M5_ADOPT),/invalid|confirmation/);
  assert.deepEqual(await readM5ApprovedBaselineRequest([
    JSON.stringify({sandboxOwnerJwt:JWT(OWNER)}),
  ],M5_INSPECT),{sandboxOwnerJwt:JWT(OWNER)});
  await assert.rejects(readM5ApprovedBaselineRequest([
    JSON.stringify({...good,vaultPath:"C:\\Naos\\Obsidian\\Naosledge"}),
  ],M5_ADOPT),/invalid/);
});

test("M5 Windows DPAPI actually seals and unseals the journal key for the same logged-on user",
  {skip:process.platform!=="win32"},async()=>{
    const secret=randomBytes(32);
    const sealed=await windowsM5KeyProtector.seal(secret);
    assert.equal(sealed.includes(secret.toString("base64")),false);
    const plain=await windowsM5KeyProtector.unseal(sealed);
    assert.deepEqual(plain,secret);
  });
