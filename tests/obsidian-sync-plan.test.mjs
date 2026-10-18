import test from "node:test";
import assert from "node:assert/strict";
import {planObsidianReconciliation} from "../lib/obsidian-sync-plan.ts";

const a="a".repeat(64),b="b".repeat(64),c="c".repeat(64);
const note=(slug,sha256,revision)=>({
  slug,sha256,...(revision?{revision}:{}),
});
const plan=(local,remote,baseline=[])=>planObsidianReconciliation({local,remote,baseline});
const choice=p=>p.decisions.map(d=>[d.slug,d.choice,d.manualReview]);

test("unchanged content never triggers a write even if a revision differs",()=>{
  const p=plan([note("knowledge",a)],[note("knowledge",a,"new-revision")],[note("knowledge",a)]);
  assert.deepEqual(choice(p),[["knowledge","unchanged",false]]);
  assert.equal(p.autoApplyAllowed,false);
  assert.equal(p.decisions[0].expectedRemoteRevision,"new-revision");
});

test("safe one-sided local edit offers a review-only upload",()=>{
  const p=plan([note("knowledge",b)],[note("knowledge",a,"rev-1")],[note("knowledge",a)]);
  assert.deepEqual(choice(p),[["knowledge","review-upload",true]]);
  assert.equal(p.decisions[0].expectedRemoteRevision,"rev-1");
  assert.equal(p.decisions[0].expectedRemoteSha,a);
  assert.equal(p.autoApplyAllowed,false);
});

test("safe one-sided remote edit offers a review-only download",()=>{
  const p=plan([note("knowledge",a)],[note("knowledge",b,"rev-2")],[note("knowledge",a)]);
  assert.deepEqual(choice(p),[["knowledge","review-download",true]]);
});

test("simultaneous divergent edits are conflicts regardless of modification time",()=>{
  const p=plan([note("knowledge",b)],[note("knowledge",c,"rev-2")],[note("knowledge",a)]);
  assert.deepEqual(choice(p),[["knowledge","conflict",true]]);
  const agree=plan([note("knowledge",b)],[note("knowledge",b)],[note("knowledge",a)]);
  assert.deepEqual(choice(agree),[["knowledge","unchanged",false]]);
});

test("first-time sync with matching notes is read-only; differing notes are conflicts",()=>{
  const p=plan([note("same",a),note("different",a)],[note("same",a),note("different",b)]);
  assert.deepEqual(choice(p),[["different","conflict",true],["same","unchanged",false]]);
});

test("files only on one side require review, never automatically copied or deleted",()=>{
  const p=plan([note("local-only",a)],[note("remote-only",b)]);
  assert.deepEqual(choice(p),[
    ["local-only","review-missing-remote",true],
    ["remote-only","review-missing-local",true],
  ]);
  assert.equal(p.autoApplyAllowed,false);
});

test("deleted-on-one-side notes are protected even if the other side is unchanged",()=>{
  const base=[note("local-gone",a),note("remote-gone",b),note("both-gone",c)];
  const p=plan([note("remote-gone",b)],[note("local-gone",a)],base);
  assert.deepEqual(choice(p),[
    ["both-gone","both-removed",false],
    ["local-gone","review-missing-local",true],
    ["remote-gone","review-missing-remote",true],
  ]);
  assert.equal(p.summary["both-removed"],1);
});

test("output order remains deterministic and inputs unmodified",()=>{
  const local=[note("z-last",a),note("a-first",a),note("middle",a)];
  const remote=[note("middle",a),note("z-last",a),note("a-first",a)];
  const before=JSON.stringify(local);
  const p=plan(local,remote);
  assert.deepEqual(p.decisions.map(x=>x.slug),["a-first","middle","z-last"]);
  assert.equal(JSON.stringify(local),before);
  assert.equal(p.summary.unchanged,3);
  assert.equal(Object.values(p.summary).reduce((a,b)=>a+b,0),3);
});

test("path traversal, mixed case, invalid hashes, unexpected privacy fields and duplicates fail closed",()=>{
  const rejects=[
    [note("../secret",a)],
    [note("My-Private",a)],
    [note("knowledge",a.toUpperCase())],
    [note("knowledge","short")],
    [note("knowledge",a),note("knowledge",b)],
    [{...note("knowledge",a),content_md:"secret private content"}],
    [{...note("knowledge",a),owner_id:"private-user"}],
    [{...note("knowledge",a),path:"C:\\secret"}],
    [{...note("knowledge",a),revision:"rev with spaces"}],
    [{...note("knowledge",a),revision:"rev:1\nheader"}],
    Array.from({length:501},(_,i)=>note("knowledge-"+i,a)),
  ];
  for(const local of rejects){
    assert.throws(()=>plan(local,[]),/unsafe|malformed|fingerprints/,JSON.stringify(local).slice(0,120));
  }
  assert.throws(()=>plan({},[]),/fingerprints/);
  assert.throws(()=>plan(null,[]),/fingerprints/);
});

test("no Markdown text or database identity is serialized into decision objects",()=>{
  const p=plan([note("safe-note",a)],[note("safe-note",b)]);
  const text=JSON.stringify(p);
  assert.doesNotMatch(text,/content_md|owner_id|password|session_token/);
  assert.ok(p.decisions.every(d=>!Object.hasOwn(d,"content_md")));
});

test("empty manifests are safe and never cause writes",()=>{
  const p=plan([],[],[]);
  assert.deepEqual(p.decisions,[]);
  assert.equal(p.autoApplyAllowed,false);
  assert.equal(Object.values(p.summary).reduce((a,b)=>a+b,0),0);
});
