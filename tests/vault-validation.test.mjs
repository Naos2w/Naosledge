import test from "node:test";
import assert from "node:assert/strict";
import {validateVaultNote,isKnowledgeId,publicDraftMarkdown} from "../lib/vault-validation.ts";

const valid={
 title:"我的私人知識",slug:"my-private-note",summary:"摘要",category:"技術",
 content_md:"[[neon-auth|身分驗證]] 與 [[RLS]]",tags:["Neon","PostgreSQL"],
 learned_on:"2026-10-17",
};
test("private note validation accepts known inputs and extracts link targets",()=>{
 const result=validateVaultNote(valid);
 assert.equal(result.ok,true);
 if(result.ok) {
   assert.deepEqual(result.value.links,["neon-auth","rls"]);
   assert.equal(result.value.title,valid.title);
 }
});
test("private note input rejects malformed or oversized data",()=>{
 for(const x of [
  null,[],{},
  {...valid,id:"not-a-uuid"},
  {...valid,slug:"Naosledge"},
  {...valid,slug:"x"},
  {...valid,title:"   "},
  {...valid,summary:"x".repeat(401)},
  {...valid,category:"a".repeat(37)},
  {...valid,content_md:"x".repeat(200001)},
  {...valid,tags:Array(13).fill("x")},
  {...valid,tags:[""]},
  {...valid,learned_on:"2026-02-30"},
  {...valid,learned_on:"2026-13-99"},
  {...valid,learned_on:"9999-99-99"},
  {...valid,learned_on:"2026/10/17"},
  {...valid,content_md:Array.from({length:81},(_,i)=>`[[note-${i+100}]]`).join(" ")},
 ]) {
  assert.equal(validateVaultNote(x).ok,false);
 }
});
test("public draft snapshot removes Wikilink syntax before manual review",()=>{
 assert.equal(publicDraftMarkdown("與 [[Neon Auth|身份驗證]]、[[RLS]] 有關"),
   "與 身份驗證、RLS 有關");
 assert.equal(isKnowledgeId("00000000-0000-4000-8000-000000000001"),true);
 assert.equal(isKnowledgeId("__proto__"),false);
});
