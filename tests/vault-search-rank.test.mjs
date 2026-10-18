import test from "node:test";
import assert from "node:assert/strict";
import {rankVaultSearchResults} from "../lib/vault-search-rank.ts";

function note(id,changes={}){
  return {
    id:String(id),
    title:"其他主題",slug:"another-topic",
    summary:"",category:"一般",tags:[],
    updated_at:"2026-10-18T00:00:00Z",
    ...changes,
  };
}

test("Chinese exact titles and title prefixes take priority over tags, summaries and body-only hits",()=>{
  const original=[
    note("body-only"), // Returned by trusted SQL RPC because its Markdown matched.
    note("summary",{summary:"這是一篇知識整理"}),
    note("tags",{tags:["知識"]}),
    note("prefix",{title:"知識圖譜",slug:"knowledge-graph"}),
    note("exact",{title:"知識",slug:"knowledge"}),
  ];
  const order=rankVaultSearchResults(original,"知識").map(x=>x.id);
  assert.deepEqual(order,["exact","prefix","tags","summary","body-only"]);
  assert.equal(original[0].id,"body-only","do not mutate DB ordering");
});

test("Unicode width, case, and title vs tag weighting are predictable",()=>{
  const rows=[
    note("tag",{tags:["AI"]}),
    note("prefix",{title:"AI 筆記"}),
    note("exact",{title:"ai"}),
    note("summary",{summary:"理解 ai 的使用"}),
  ];
  assert.deepEqual(
    rankVaultSearchResults(rows,"ＡＩ").map(n=>n.id),
    ["exact","prefix","tag","summary"],
  );
});

test("multiple Chinese or English terms are split for metadata relevance",()=>{
  const rows=[
    note("body-only"),
    note("one",{title:"資料模型"}),
    note("both",{title:"資料模型",tags:["PostgreSQL"]}),
  ];
  const order=rankVaultSearchResults(rows,"資料 PostgreSQL").map(n=>n.id);
  assert.deepEqual(order,["both","one","body-only"]);
});

test("a query that only matched Markdown remains visible and keeps the RPC's recency order",()=>{
  const rows=[note("most-recent"),note("older"),note("oldest")];
  assert.deepEqual(rankVaultSearchResults(rows,"only-in-markdown").map(n=>n.id),
    ["most-recent","older","oldest"]);
});

test("blank queries, ties, unusual tags and input arrays remain intact",()=>{
  const rows=[
    note("a",{title:"Ａｕｔｈ",tags:["__proto__"]}),
    note("b",{title:"auth"}),
  ];
  assert.deepEqual(rankVaultSearchResults(rows,"").map(n=>n.id),["a","b"]);
  assert.deepEqual(rankVaultSearchResults(rows,"auth").map(n=>n.id),["a","b"]);
  assert.deepEqual(rankVaultSearchResults(rows,"__proto__").map(n=>n.id),["a","b"]);
  assert.equal(rows[0].title,"Ａｕｔｈ");
  assert.equal(rows[0].tags.length,1);
  assert.deepEqual(rankVaultSearchResults([],"知識"),[]);
  assert.equal(rankVaultSearchResults([rows[0]],"知識")[0],rows[0]);
});

test("ranking never reads or leaks owner ids and private content in candidate objects",()=>{
  const onlyMetadata=[note("before",{title:"My private theme",tags:["PRIVATE"]}),note("after",{summary:"private"})];
  const sorted=rankVaultSearchResults(onlyMetadata,"private");
  assert.equal(sorted.length,2);
  assert.equal(sorted[0].id,"before");
  assert.equal(JSON.stringify(sorted).includes("content_md"),false);
  assert.equal(JSON.stringify(sorted).includes("owner_id"),false);
});
