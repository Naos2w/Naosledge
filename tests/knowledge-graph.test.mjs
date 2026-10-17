import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnowledgeGraph,layoutKnowledgeGraph,connectedGraphNotes,
  GRAPH_H,GRAPH_W,
} from "../lib/knowledge-graph.ts";

const id=(i)=>`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`;
const notes=[
 {id:id(1),slug:"neon-auth",title:"Neon 登入",category:"身份驗證",tags:["Neon","JWT"]},
 {id:id(2),slug:"rls",title:"RLS 權限",category:"資料庫",tags:["SQL"]},
 {id:id(3),slug:"nextjs",title:"Next.js",category:"前端",tags:["Next"]},
 {id:id(4),slug:"sql-guide",title:"共同標題",category:"資料庫",tags:[]},
 {id:id(5),slug:"sql-guide-two",title:"共同標題",category:"資料庫",tags:[]},
];
const refs=[
 {source_note_id:id(2),target_key:"neon-auth"},
 {source_note_id:id(2),target_key:"Neon 登入"},
 {source_note_id:id(1),target_key:"RLS"},
 {source_note_id:id(3),target_key:"rls"},
 {source_note_id:id(3),target_key:"No-Such-Note"},
 {source_note_id:id(3),target_key:"共同標題"},
 {source_note_id:id(3),target_key:"__proto__"},
 {source_note_id:id(3),target_key:"nextjs"},
];
test("private graph shows owner-scoped identity labels but never body or unrelated publication data",()=>{
 const extra={...notes[0],content_md:"TOP SECRET",owner_id:"user-private",unpublished_mapping:"SENSITIVE_MAPPING_SECRET_456"};
 const graph=buildKnowledgeGraph([extra,...notes.slice(1)],refs);
 assert.equal(graph.nodes.length,5);
 assert.equal(graph.edges.length,3);
 assert.equal(graph.unresolvedCount,3);
 assert.deepEqual(graph.edges,[
  {source:id(2),target:id(1)},
  {source:id(1),target:id(2)},
  {source:id(3),target:id(2)},
 ]);
 assert.ok(!JSON.stringify(graph).includes("TOP SECRET"));
 assert.ok(!JSON.stringify(graph).includes("user-private"));
 assert.ok(!JSON.stringify(graph).includes("SENSITIVE_MAPPING_SECRET_456"));
});

test("missing, duplicate and invalid nodes cannot become dangling graph edges",()=>{
 const graph=buildKnowledgeGraph([...notes,notes[1],
   {id:"not-uuid",slug:"bad",title:"Bad",category:"Test",tags:[]}],[
   {source_note_id:"other-owner-uuid",target_key:"rls"},
   {source_note_id:id(1),target_key:"sql-guide"},
   {source_note_id:id(1),target_key:"sql-guide"},
   {source_note_id:id(1),target_key:"no-such-note"},
 ]);
 assert.equal(graph.nodes.length,5);
 assert.equal(graph.edges.length,1);
 assert.deepEqual(graph.edges[0],{source:id(1),target:id(4)});
 assert.equal(graph.hiddenReferenceCount,1);
 assert.equal(graph.unresolvedCount,1);
});
test("ambiguous titles never make the graph connect to an arbitrary target",()=>{
 const graph=buildKnowledgeGraph(notes,[
  {source_note_id:id(1),target_key:"共同標題"},
 ]);
 assert.deepEqual(graph.edges,[]);
 assert.equal(graph.unresolvedCount,1);
});
test("deterministic overview never exceeds graph canvas bounds",()=>{
 const graph=buildKnowledgeGraph(notes,refs);
 const first=layoutKnowledgeGraph(graph,null,100);
 const again=layoutKnowledgeGraph(graph,null,100);
 assert.deepEqual(first,again);
 assert.equal(first.points.length,5);
 assert.equal(first.edges.length,3);
 assert.equal(first.partial,false);
 for(const p of first.points){
   assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
   assert.ok(p.x>=0&&p.x<=GRAPH_W);
   assert.ok(p.y>=0&&p.y<=GRAPH_H);
 }
});
test("selected focus shows only neighbours to distance 2 and no irrelevant owner graph nodes",()=>{
 const graph=buildKnowledgeGraph(notes,refs);
 const focused=layoutKnowledgeGraph(graph,id(1),100);
 const byId=new Map(focused.points.map(p=>[p.id,p]));
 assert.equal(byId.get(id(1)).distance,0);
 assert.equal(byId.get(id(2)).distance,1);
 assert.equal(byId.get(id(3)).distance,2);
 assert.ok(!byId.has(id(4))&&!byId.has(id(5)));
 assert.equal(focused.edges.length,3);
 assert.deepEqual(connectedGraphNotes(graph,id(1)),[id(2)]);
 assert.deepEqual(connectedGraphNotes(graph,"not-a-note"),[]);
});
test("large datasets limit graphical work and mark partial disclosure accurately",()=>{
 const many=Array.from({length:280},(_,i)=>({
   id:id(i+200),slug:`private-note-${i}`,title:`Node ${i}`,
   category:`Category ${i%7}`,tags:[],
 }));
 const refs=many.slice(1).map((n,i)=>({source_note_id:n.id,target_key:many[i].slug}));
 const graph=buildKnowledgeGraph(many,refs);
 const overview=layoutKnowledgeGraph(graph,null,70);
 assert.equal(overview.points.length,70);
 assert.equal(overview.partial,true);
 assert.ok(overview.edges.length<=70);
 const focus=layoutKnowledgeGraph(graph,many[50].id,150);
 assert.ok(focus.points.length<=150);
 assert.ok(focus.points.some(x=>x.id===many[50].id));
 for(const e of focus.edges){
   assert.ok(focus.points.some(p=>p.id===e.source));
   assert.ok(focus.points.some(p=>p.id===e.target));
 }
});
test("malformed IDs are excluded from target resolution even in direct relationships",()=>{
 const graph=buildKnowledgeGraph([
   {id:"__proto__",slug:"proto",title:"Protocol",category:"Tests",tags:[]},
   ...notes,
 ],[{source_note_id:id(1),target_key:"proto"},{source_note_id:id(1),target_key:"__proto__"}]);
 assert.equal(graph.nodes.length,5);
 assert.equal(graph.edges.length,0);
 assert.equal(graph.unresolvedCount,2);
});
