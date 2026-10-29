import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {planAutomaticObsidianSync} from "../lib/obsidian-auto-sync-policy.ts";
import {RELEASE_NEON_BRANCH} from "../lib/neon/production-release.ts";

const A="a".repeat(64),B="b".repeat(64),C="c".repeat(64);
const note=(slug,sha256,revision)=>({
  slug,sha256,...(revision?{revision}:{})
});
const local=(fingerprints,props={})=>({
  fingerprints,unsupportedMarkdownFiles:0,otherFiles:0,
  directoriesNotScanned:0,autoApplyAllowed:false,...props,
});
const remote=(fingerprints,props={})=>({
  branchId:RELEASE_NEON_BRANCH,
  fingerprints,numberOfNotes:fingerprints.length,
  fullInventory:true,ownerRlsVerified:true,writeEnabled:false,...props,
});
const trust=(diff={})=>({
  initialPairingApproved:true,durableBaselineVerified:true,
  ownerSessionFresh:true,productionSchemaReady:true,...diff,
});
const plan=(l,r,b=[],t=trust())=>planAutomaticObsidianSync({
  local:local(l),remote:remote(r),baseline:b,trust:t,
});
const bySlug=result=>Object.fromEntries(result.candidates.map(c=>[c.slug,c]));
const assertNoExecution=r=>{
  assert.equal(r.automaticTransfersEnabled,false);
  assert.equal(r.automaticDeletionEnabled,false);
  assert.equal(r.backgroundAgentStarted,false);
  assert.equal(r.baselineUpdated,false);
  for(const c of r.candidates){
    assert.equal(c.executable,false);
    assert.equal(c.automaticDeletionAllowed,false);
    assert.equal(c.requiresFreshTwoSidedRead,true);
    assert.equal(c.baselineCommitOnlyAfterVerifiedReadback,true);
  }
};

test("automatic policy turns one-sided known edits into CAS upload or backed-up download candidates",()=>{
  const base=[note("local-edit",A),note("remote-edit",A)];
  const l=[note("local-edit",B),note("remote-edit",A)];
  const r=[note("local-edit",A,"rev-1"),note("remote-edit",C,"rev-2")];
  const output=plan(l,r,base);
  assert.equal(output.state,"ready-to-wire");
  assert.equal(output.autoCandidateCount,2);
  assert.equal(output.manualReviewCount,0);
  const items=bySlug(output);
  assert.equal(items["local-edit"].action,"upload-cas");
  assert.equal(items["local-edit"].expectedRemoteSha,A);
  assert.equal(items["local-edit"].expectedRemoteRevision,"rev-1");
  assert.equal(items["local-edit"].requiresDurableBackup,false);
  assert.equal(items["remote-edit"].action,"download-replace");
  assert.equal(items["remote-edit"].expectedLocalSha,A);
  assert.equal(items["remote-edit"].requiresDurableBackup,true);
  assertNoExecution(output);
});

test("after an approved pairing, genuinely new one-sided notes become create-only upload/download candidates",()=>{
  const output=plan([note("local-new",A)], [note("remote-new",B,"rev-new")]);
  assert.deepEqual(output.candidates.map(c=>[c.slug,c.action]),[
    ["local-new","upload-create"],
    ["remote-new","download-new"],
  ]);
  assert.equal(output.autoCandidateCount,2);
  assert.equal(output.candidates[0].expectedRemoteSha,null);
  assert.equal(output.candidates[0].expectedRemoteRevision,null);
  assertNoExecution(output);
});

test("a disappeared previously paired note is ALWAYS manual deletion review; never auto-recreated",()=>{
  const old=[note("gone-local",A),note("gone-remote",B),note("gone-both",C)];
  const output=plan([note("gone-remote",B)], [note("gone-local",A,"rev")],old);
  assert.deepEqual(output.candidates.map(c=>[c.slug,c.action]),[
    ["gone-both","manual-deletion"],
    ["gone-local","manual-deletion"],
    ["gone-remote","manual-deletion"],
  ]);
  assert.equal(output.autoCandidateCount,0);
  assert.equal(output.manualReviewCount,3);
  assertNoExecution(output);
});

test("two-sided edits, an initial-name collision, or unknown identity are never auto-merged",()=>{
  const first=plan([note("conflict",B)],[note("conflict",C,"rev")],[note("conflict",A)]);
  const second=plan([note("collision",A)],[note("collision",B,"rev")]);
  assert.deepEqual(first.candidates.map(c=>c.action),["manual-conflict"]);
  assert.deepEqual(second.candidates.map(c=>c.action),["manual-conflict"]);
  assertNoExecution(first);assertNoExecution(second);
});

test("without a remote revision, update/download is manual even if SHA indicates one-sided change",()=>{
  const base=[note("upload",A),note("download",A)];
  const v=plan([note("upload",B),note("download",A)],
    [note("upload",A),note("download",B)],base);
  assert.deepEqual(v.candidates.map(c=>c.action),[
    "manual-missing-revision","manual-missing-revision",
  ]);
  assert.equal(v.autoCandidateCount,0);
  const fresh=plan([],[note("remote-fresh",B)]);
  assert.equal(fresh.candidates[0].action,"manual-missing-revision");
  assertNoExecution(v);
});

test("matching current SHA never triggers an upload or download",()=>{
  const result=plan([note("match",A)],[note("match",A,"different-revision")],[note("match",B)]);
  assert.equal(result.candidates[0].action,"unchanged");
  assert.equal(result.autoCandidateCount,0);
  assert.equal(result.manualReviewCount,0);
  assertNoExecution(result);
});

test("initial pairing must be approved, and journal / auth / schema must all be independently verified",()=>{
  for(const change of [
    {initialPairingApproved:false},
    {durableBaselineVerified:false},
    {ownerSessionFresh:false},
    {productionSchemaReady:false},
    {initialPairingApproved:false,ownerSessionFresh:false},
  ]){
    const result=plan([note("ready-looking",A)],[],[],trust(change));
    assert.equal(result.state,"blocked");
    assert.equal(result.autoCandidateCount,0);
    assert.equal(result.candidates[0].action,"blocked");
    assert.equal(result.reasons.length,Object.values(change).filter(x=>x===false).length);
    assertNoExecution(result);
  }
});

test("unsupported .md names or unscanned nested folders stop the WHOLE cycle, rather than silently dropping notes",()=>{
  for(const coverage of [
    {unsupportedMarkdownFiles:1},
    {directoriesNotScanned:1},
    {unsupportedMarkdownFiles:2,directoriesNotScanned:4},
  ]){
    const result=planAutomaticObsidianSync({
      local:local([note("known",A)],coverage),
      remote:remote([]),baseline:[],trust:trust(),
    });
    assert.equal(result.state,"blocked");
    assert.deepEqual(result.reasons,["local-coverage-incomplete"]);
    assert.equal(result.candidates[0].action,"blocked");
    assertNoExecution(result);
  }
  // Non-Markdown files are not automatically deleted, uploaded or examined.
  const nonMarkdown=planAutomaticObsidianSync({
    local:local([note("known",A)],{otherFiles:4}),
    remote:remote([]),baseline:[],trust:trust(),
  });
  assert.equal(nonMarkdown.candidates[0].action,"upload-create");
  assertNoExecution(nonMarkdown);
});

test("remote count, role, branch, completeness or accidental write-capability mismatch all fail closed",()=>{
  const bad=[
    {branchId:"br-quiet-sunset-b4xx4pnx"},
    {branchId:"br-different"},
    {ownerRlsVerified:false},{fullInventory:false},
    {writeEnabled:true},
    {numberOfNotes:0},
    {numberOfNotes:2},
    {numberOfNotes:NaN},
    {numberOfNotes:1.2},
    {remoteSecret:"no private contents"},
    {fingerprints:[...Array.from({length:501},(_,i)=>note("n-"+i,A))]},
  ];
  for(const diff of bad){
    assert.throws(()=>planAutomaticObsidianSync({
      local:local([]),
      remote:remote([note("known",A,"rev")],diff),
      baseline:[],trust:trust(),
    }),/Production Owner-RLS inventory/);
  }
});

test("malformed local, baseline and trust are rejected instead of assumed empty",()=>{
  const badLocal=[
    {autoApplyAllowed:true},
    {fingerprints:undefined},
    {fingerprints:"not-an-array"},
    {directoriesNotScanned:-1},
    {unsupportedMarkdownFiles:0.5},
    {otherFiles:NaN},
    {extraPrivateBody:"private"},
  ];
  for(const diff of badLocal)assert.throws(()=>planAutomaticObsidianSync({
    local:local([],diff),remote:remote([]),baseline:[],trust:trust(),
  }),/local metadata/);

  for(const bad of [
    null,undefined,{},[],
    {...trust(),ownerSessionFresh:"true"},
    {...trust(),privateJwt:"secret"},
  ])assert.throws(()=>planAutomaticObsidianSync({
    local:local([]),remote:remote([]),baseline:[],trust:bad,
  }),/pairing prerequisites/);

  for(const b of [
    null,{},[note("../private",A)],[note("duplicate",A),note("duplicate",B)],
    [{...note("bad",A),content_md:"secret"}],
  ])assert.throws(()=>plan([],[],b),/baseline|fingerprints/);
});

test("policy preserves safe slug/hash/revisions; never materializes bodies, JWT or a write function",()=>{
  const args={
    local:local([note("safe-note",B)]),
    remote:remote([note("safe-note",A,"rev-1")]),
    baseline:[note("safe-note",A)],
    trust:trust(),
  };
  const original=JSON.stringify(args);
  const output=planAutomaticObsidianSync(args);
  assert.equal(JSON.stringify(args),original);
  const serialized=JSON.stringify(output);
  assert.doesNotMatch(serialized,/content_md|Markdown|password|Authorization|bearer|cookie|jwt|owner_id/i);
  assert.match(serialized,/upload-cas/);
  assertNoExecution(output);
});

test("policy is an inert module: it has no timer, network, filesystem or actual executor",async()=>{
  const source=await readFile(new URL("../lib/obsidian-auto-sync-policy.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/from "node:fs|from "node:http|from "node:net|setTimeout\(|setInterval\(|process\.env|fetch\(|watch\(|writeFile\(|mkdir\(|rename\(|\.rpc\(|\.post\(|\.patch\(|\.delete\(/);
  assert.doesNotMatch(source,/function execute|async function run|await /);
});

test("empty initial pair and all unchanged still have zero operations and no M5 baseline mutation",()=>{
  for(const input of [
    {local:local([]),remote:remote([]),baseline:[],trust:trust()},
    {local:local([note("equal",A)]),remote:remote([note("equal",A,"rev")]),baseline:[],trust:trust()},
  ]){
    const p=planAutomaticObsidianSync(input);
    assert.equal(p.autoCandidateCount,0);
    assert.equal(p.manualReviewCount,0);
    assertNoExecution(p);
  }
});
