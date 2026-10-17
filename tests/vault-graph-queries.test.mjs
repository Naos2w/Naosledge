import test from "node:test";
import assert from "node:assert/strict";
import {createNeonDataApiClient} from "../lib/neon/data-api.ts";
import {
  GRAPH_QUERY_ID_BATCH_SIZE,graphNoteIdBatches,selectGraphReferences,
} from "../lib/vault-graph-queries.ts";

const id=(n)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const api="https://ep-synthetic.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";

test("180 private graph IDs are broken into short, owner-scoped Data API GET requests",async()=>{
  const ids=Array.from({length:180},(_,i)=>id(i+1));
  const batches=graphNoteIdBatches(ids);
  assert.equal(GRAPH_QUERY_ID_BATCH_SIZE,48);
  assert.equal(batches.length,4);
  assert.deepEqual(batches.flat(),ids);
  assert.ok(batches.every(b=>b.length>0&&b.length<=48));
  assert.deepEqual(graphNoteIdBatches([]),[]);
  const urls=[];
  const client=createNeonDataApiClient(api,async()=>"synthetic.jwt.only-for-test",async(input,init)=>{
    const url=String(input);
    urls.push(url);
    assert.equal(new Headers(init.headers).get("Authorization"),"Bearer synthetic.jwt.only-for-test");
    return new Response("[]",{status:200,headers:{"content-type":"application/json"}});
  });
  for(const batch of batches){
    const result=await client.from("knowledge_links")
      .select("source_note_id,target_key,created_at")
      .eq("owner_id","synthetic-owner")
      .in("source_note_id",batch)
      .order("created_at",{ascending:false})
      .order("source_note_id",{ascending:true})
      .order("target_key",{ascending:true})
      .limit(2401);
    assert.equal(result.error,null);
  }
  assert.equal(urls.length,4);
  assert.ok(urls.every(url=>url.length<3000),"Query URL must stay below 3 KB");
  assert.ok(urls.every(url=>url.includes("owner_id=eq.synthetic-owner")));
  assert.ok(urls.every(url=>!url.includes("jwt.only-for-test")));
});

test("batch merging keeps globally newest links, not the first batch or private timestamps",()=>{
  const make=(n,day)=>({
    source_note_id:id(n),target_key:`note-${n}`,
    created_at:`2026-10-${String(day).padStart(2,"0")}T12:00:00.000Z`,
  });
  const result=selectGraphReferences([
    [make(1,9),make(2,7)],
    [make(3,10),make(4,8)],
  ],3);
  assert.equal(result.truncated,true);
  assert.deepEqual(result.references.map(r=>r.source_note_id),[id(3),id(1),id(4)]);
  assert.ok(result.references.every(r=>!Object.hasOwn(r,"created_at")));
  assert.deepEqual(selectGraphReferences([],2400),{references:[],truncated:false});
});

test("2,400-link limit is exact across batches, including deterministic ties",()=>{
  const rows=Array.from({length:2401},(_,n)=>({
    source_note_id:id(n+1),target_key:`linked-${n}`,
    created_at:"2026-10-17T12:00:00.000Z",
  }));
  assert.equal(selectGraphReferences([rows.slice(0,1500),rows.slice(1500)],2400).truncated,true);
  assert.equal(selectGraphReferences([rows.slice(0,1200),rows.slice(1200,2400)],2400).truncated,false);
  const first=selectGraphReferences([rows.slice(0,1500),rows.slice(1500)],2400);
  const reversed=selectGraphReferences([rows.slice(1500),rows.slice(0,1500)],2400);
  assert.deepEqual(first,reversed);
  assert.equal(first.references.length,2400);
});
