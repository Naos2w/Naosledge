import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat,mkdir,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createObsidianSandbox} from "../lib/obsidian-sync-sandbox.ts";

const sha=v=>createHash("sha256").update(v).digest("hex");
const a=(slug,direction)=>({slug,direction,confirmation:"APPROVE "+direction.toUpperCase()+" "+slug});

async function withScratch(callback){
  const sandbox=await createObsidianSandbox();
  try{
    assert.equal(path.dirname(sandbox.sandboxDirectory),path.resolve(tmpdir()));
    assert.match(path.basename(sandbox.sandboxDirectory),/^naosledge-obsidian-sandbox-only-/);
    return await callback(sandbox);
  }finally{
    await sandbox.close();
  }
}

test("empty scratch preview is read-only and keeps transfer disabled",async()=>{
  await withScratch(async s=>{
    const p=await s.preview();
    assert.deepEqual(p.decisions,[]);
    assert.equal(p.autoApplyAllowed,false);
    assert.equal(await s.localBackupCountForTest(),0);
    await assert.rejects(s.apply(a("demo","upload")),/not in/);
  });
});

test("manual local-only upload to in-memory remote requires exact per-note approval",async()=>{
  await withScratch(async s=>{
    await s.seedLocal("my-note","## local synthetic\n[[wikilink]]");
    const p=await s.preview();
    assert.deepEqual(p.decisions.map(x=>x.choice),["review-missing-remote"]);
    assert.equal(s.syntheticRemoteContentForTest("my-note"),null);
    await assert.rejects(s.apply({slug:"my-note",direction:"upload",confirmation:"yes"}),/Explicit/);
    assert.equal(s.syntheticRemoteContentForTest("my-note"),null);
    const receipt=await s.apply(a("my-note","upload"));
    assert.deepEqual({
      sandboxOnly:receipt.sandboxOnly,direction:receipt.direction,
      auto:receipt.automaticSyncEnabled,backedUp:receipt.backedUpExistingLocal,
    },{sandboxOnly:true,direction:"upload",auto:false,backedUp:false});
    assert.equal(s.syntheticRemoteContentForTest("my-note"),"## local synthetic\n[[wikilink]]");
    await assert.rejects(s.apply(a("my-note","upload")),/preview required/);
    assert.equal((await s.preview()).decisions[0].choice,"unchanged");
  });
});

test("manual remote-only download writes ONLY synthetic scratch file",async()=>{
  await withScratch(async s=>{
    s.seedSyntheticRemote("from-remote","## Synthetic remote only");
    const p=await s.preview();
    assert.equal(p.decisions[0].choice,"review-missing-local");
    assert.equal(await s.localContentForTest("from-remote"),null);
    const receipt=await s.apply(a("from-remote","download"));
    assert.equal(receipt.backedUpExistingLocal,false);
    assert.equal(await s.localContentForTest("from-remote"),"## Synthetic remote only");
    assert.equal((await s.preview()).decisions[0].choice,"unchanged");
  });
});

test("local edit since common baseline becomes a review-only upload",async()=>{
  await withScratch(async s=>{
    s.setBaseline([{slug:"edited",sha256:sha("first")}]);
    await s.seedLocal("edited","local second");
    s.seedSyntheticRemote("edited","first");
    assert.equal((await s.preview()).decisions[0].choice,"review-upload");
    await s.apply(a("edited","upload"));
    assert.equal(s.syntheticRemoteContentForTest("edited"),"local second");
    assert.equal((await s.preview()).decisions[0].choice,"unchanged");
  });
});

test("remote edit becomes reviewed local overwrite with backup in TEMP ONLY",async()=>{
  await withScratch(async s=>{
    s.setBaseline([{slug:"edited",sha256:sha("first")}]);
    await s.seedLocal("edited","first");
    s.seedSyntheticRemote("edited","remote new");
    const before=await s.preview();
    assert.equal(before.decisions[0].choice,"review-download");
    assert.equal(await s.localBackupCountForTest(),0);
    const receipt=await s.apply(a("edited","download"));
    assert.equal(receipt.backedUpExistingLocal,true);
    assert.equal(await s.localBackupCountForTest(),1);
    assert.equal(await s.localContentForTest("edited"),"remote new");
    assert.equal((await s.preview()).decisions[0].choice,"unchanged");
  });
});

test("two-sided modifications with a baseline remain a strict conflict",async()=>{
  await withScratch(async s=>{
    s.setBaseline([{slug:"conflicted",sha256:sha("initial")}]);
    await s.seedLocal("conflicted","locally modified");
    s.seedSyntheticRemote("conflicted","remotely modified");
    assert.equal((await s.preview()).decisions[0].choice,"conflict");
    await assert.rejects(s.apply(a("conflicted","upload")),/Conflicts/);
    await assert.rejects(s.apply(a("conflicted","download")),/Conflicts/);
    assert.equal(await s.localContentForTest("conflicted"),"locally modified");
    assert.equal(s.syntheticRemoteContentForTest("conflicted"),"remotely modified");
    assert.equal(await s.localBackupCountForTest(),0);
  });
});

test("first-time same-name disagreement must be manually resolved, not overwritten",async()=>{
  await withScratch(async s=>{
    await s.seedLocal("same-slug","local origin");
    s.seedSyntheticRemote("same-slug","remote origin");
    assert.equal((await s.preview()).decisions[0].choice,"conflict");
    await assert.rejects(s.apply(a("same-slug","upload")),/Conflicts/);
    assert.equal(s.syntheticRemoteContentForTest("same-slug"),"remote origin");
  });
});

test("a stale synthetic remote update rejects upload after preview",async()=>{
  await withScratch(async s=>{
    s.setBaseline([{slug:"stale",sha256:sha("v1")}]);
    await s.seedLocal("stale","v2");
    s.seedSyntheticRemote("stale","v1");
    assert.equal((await s.preview()).decisions[0].choice,"review-upload");
    s.mutateSyntheticRemote("stale","v3 concurrently");
    await assert.rejects(s.apply(a("stale","upload")),/Stale preview/);
    assert.equal(s.syntheticRemoteContentForTest("stale"),"v3 concurrently");
    assert.equal(await s.localContentForTest("stale"),"v2");
  });
});

test("stale local edits reject remote downloads without backup or overwrite",async()=>{
  await withScratch(async s=>{
    s.setBaseline([{slug:"stale",sha256:sha("v1")}]);
    await s.seedLocal("stale","v1");
    s.seedSyntheticRemote("stale","remote new");
    assert.equal((await s.preview()).decisions[0].choice,"review-download");
    await writeFile(path.join(s.sandboxDirectory,"stale.md"),"someone edited in Obsidian");
    await assert.rejects(s.apply(a("stale","download")),/Stale preview/);
    assert.equal(await s.localContentForTest("stale"),"someone edited in Obsidian");
    assert.equal(await s.localBackupCountForTest(),0);
  });
});

test("wrong direction and unapproved note may not mutate either side",async()=>{
  await withScratch(async s=>{
    await s.seedLocal("one-note","private synthetic");
    await s.preview();
    await assert.rejects(s.apply(a("one-note","download")),/Conflicts/);
    await assert.rejects(s.apply(a("another-note","upload")),/not in/);
    assert.equal(s.syntheticRemoteContentForTest("one-note"),null);
    assert.equal(await s.localContentForTest("one-note"),"private synthetic");
  });
});

test("missing item never triggers automatic deletion",async()=>{
  await withScratch(async s=>{
    s.setBaseline([{slug:"deleted-locally",sha256:sha("v1")}]);
    s.seedSyntheticRemote("deleted-locally","v1");
    const p=await s.preview();
    assert.equal(p.decisions[0].choice,"review-missing-local");
    assert.equal(s.syntheticRemoteContentForTest("deleted-locally"),"v1");
    await assert.rejects(s.apply(a("deleted-locally","upload")),/Conflicts/);
    assert.equal(s.syntheticRemoteContentForTest("deleted-locally"),"v1");
  });
});

test("malicious traversal, oversized and duplicate synthetic notes rejected",async()=>{
  await withScratch(async s=>{
    await assert.rejects(s.seedLocal("../secret","x"),/Unsafe/);
    await assert.rejects(s.seedLocal("My-Note","x"),/Unsafe/);
    await assert.rejects(s.seedLocal("huge-note","x".repeat(250001)),/limit/);
    await s.seedLocal("safe-note","safe synthetic");
    await assert.rejects(s.seedLocal("safe-note","replacement"),/EEXIST/);
    assert.equal(await s.localContentForTest("safe-note"),"safe synthetic");
    assert.equal(s.syntheticRemoteContentForTest("safe-note"),null);
  });
});

test("closed scratch folder is removed; no persistent worker or watch",async()=>{
  const s=await createObsidianSandbox();
  const dir=s.sandboxDirectory;
  await s.seedLocal("one-note","safe");
  await s.close();
  await s.close();
  await assert.rejects(lstat(dir),/ENOENT/);
  await assert.rejects(s.preview(),/closed/);
});

test("unmatched baseline leaves two missing copies inert, no auto deletion",async()=>{
  await withScratch(async s=>{
    s.setBaseline([{slug:"old-note",sha256:sha("once existed")}]);
    const p=await s.preview();
    assert.equal(p.decisions[0].choice,"both-removed");
    await assert.rejects(s.apply(a("old-note","download")),/Conflicts/);
    await assert.rejects(s.apply(a("old-note","upload")),/Conflicts/);
  });
});


test("scanner config exclusion does not expand sandbox's backup-only directory allowance",async()=>{
  await withScratch(async s=>{
    await mkdir(path.join(s.sandboxDirectory,".sandbox-backups"));
    assert.deepEqual((await s.preview()).decisions,[]);
    await mkdir(path.join(s.sandboxDirectory,".obsidian"));
    await assert.rejects(s.preview(),/unexpected files or folders/);
  });
  await withScratch(async s=>{
    await mkdir(path.join(s.sandboxDirectory,"actual-notes"));
    await assert.rejects(s.preview(),/unexpected files or folders/);
  });
});
