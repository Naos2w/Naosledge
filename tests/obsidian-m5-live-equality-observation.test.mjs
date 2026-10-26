import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,unlink,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {previewManualObsidianSync} from "../lib/obsidian-manual-sync-review.ts";
import {
  reverifyM5EqualSourceObservation,saveM5EqualSourceObservation,
} from "../lib/obsidian-m5-equality-observation.ts";
import {
  assertManualM5Invocation,M5_OBSERVE,M5_REVERIFY,
  readM5ManualRequest,runM5ManualObservation,
} from "../scripts/obsidian-m5-manual-equality.ts";

const sha=s=>createHash("sha256").update(s).digest("hex");
async function preview({
  localSha=sha("equal"),remoteSha=sha("equal"),
  revision=sha("revision"),partial=false,
}={}){
  return previewManualObsidianSync({
    baseline:[],
    readLocal:async()=>({
      fingerprints:[{slug:"sample-note",sha256:localSha}],
      unsupportedMarkdownFiles:0,otherFiles:0,
      directoriesNotScanned:partial?1:0,autoApplyAllowed:false,
    }),
    readRemote:async()=>({
      fingerprints:[{slug:"sample-note",sha256:remoteSha,revision}],
      numberOfNotes:1,sandboxOnly:true,rlsEnforcedByDataApi:true,
      writeEnabled:false,fullInventory:true,
    }),
  });
}

test("M5 persists current two-source equality without granting a Baseline, then verifies after Node restart",async()=>{
  const snap=await preview();
  const result=await runM5ManualObservation(M5_OBSERVE,
    {sandboxOwnerJwt:"header.payload.sig"},
    async ({sandboxOwnerJwt,baseline})=>{
      assert.equal(sandboxOwnerJwt,"header.payload.sig");
      assert.deepEqual(baseline,[]);
      return snap;
    });
  assert.equal(result.count,1);
  assert.equal(result.baselineSaved,false);
  const file=result.path;
  assert.ok(file);
  try{
    const raw=await readFile(file,"utf8");
    assert.match(raw,/naosledge.m5.equal-sources-observation.v1/);
    assert.equal(raw.includes("jwt"),false);
    assert.equal(raw.includes("markdown"),false);
    const script=`
      import {reverifyM5EqualSourceObservation} from ${JSON.stringify(
        new URL("../lib/obsidian-m5-equality-observation.ts",import.meta.url).href
      )};
      const result=await reverifyM5EqualSourceObservation(process.argv[1],
        JSON.parse(Buffer.from(process.argv[2],"base64url").toString("utf8")));
      if(result.stillEqualNotes!==1||result.baselineSaved!==false)process.exit(2);
    `;
    const child=spawnSync(process.execPath,[
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON","--input-type=module",
      "-e",script,file,Buffer.from(JSON.stringify(snap)).toString("base64url"),
    ],{encoding:"utf8",timeout:10_000});
    assert.equal(child.status,0,child.stderr);
    const verified=await runM5ManualObservation(M5_REVERIFY,
      {sandboxOwnerJwt:"header.payload.sig",observationPath:file},
      async()=>preview());
    assert.equal(verified.count,1);
    assert.equal(verified.baselineSaved,false);
  }finally{await unlink(file);}
});

test("M5 refuses false restored Baselines on changes, incomplete coverage or receipt tampering",async()=>{
  for(const bad of [
    await preview({localSha:sha("changed")}),
    await preview({remoteSha:sha("changed")}),
    await preview({partial:true}),
  ]){
    await assert.rejects(saveM5EqualSourceObservation(bad),
      /complete|no complete/);
  }
  const good=await preview();
  const saved=await saveM5EqualSourceObservation(good);
  try{
    await assert.rejects(reverifyM5EqualSourceObservation(saved.path,
      await preview({revision:sha("new-revision")})),/disagree/);
    await assert.rejects(reverifyM5EqualSourceObservation(saved.path,
      await preview({localSha:sha("modified")})),/no complete/);
    const bytes=await readFile(saved.path,"utf8");
    await writeFile(saved.path,bytes.replace('"baselineSaved":false','"baselineSaved":true'));
    await assert.rejects(reverifyM5EqualSourceObservation(saved.path,good),
      /invalid/);
  }finally{await unlink(saved.path);}
});

test("M5 manual operation requires MSI, explicit mode, bounded stdin JSON; no JWT in argv",async()=>{
  assert.doesNotThrow(()=>assertManualM5Invocation("win32","MSI",[M5_OBSERVE],false));
  assert.throws(()=>assertManualM5Invocation("linux","MSI",[M5_OBSERVE],false),/MSI-only/);
  assert.throws(()=>assertManualM5Invocation("win32","MSI",[M5_REVERIFY],true),/piped/);
  assert.throws(()=>assertManualM5Invocation("win32","OTHER",[M5_OBSERVE],false),/MSI-only/);
  const jwt="header.payload.signature";
  const request=await readM5ManualRequest([JSON.stringify({sandboxOwnerJwt:jwt})],M5_OBSERVE);
  assert.deepEqual(request,{sandboxOwnerJwt:jwt});
  await assert.rejects(readM5ManualRequest([JSON.stringify({
    sandboxOwnerJwt:jwt,observationPath:"C:/Vault",
  })],M5_OBSERVE),/invalid/);
  await assert.rejects(readM5ManualRequest([JSON.stringify({sandboxOwnerJwt:jwt})],
    M5_REVERIFY),/invalid/);
  await assert.rejects(readM5ManualRequest(["x".repeat(12_001)],M5_OBSERVE),/limit/);
});
