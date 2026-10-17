import {normalizeWikiKey,wikiTargetMap} from "./wiki-links.ts";

export type KnowledgeGraphNote={
  id:string; slug:string; title:string; category:string; tags:string[];
};
export type KnowledgeGraphReference={
  source_note_id:string; target_key:string;
};
export type KnowledgeGraphEdge={source:string;target:string};
export type KnowledgeGraph={
  nodes:KnowledgeGraphNote[];
  edges:KnowledgeGraphEdge[];
  unresolvedCount:number;
  hiddenReferenceCount:number;
};

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

/**
 * Graph generation is pure and does not fetch user data. Callers must first
 * authenticate the actual owner and query ONLY their own RLS-protected notes.
 * Only identity/label/category information is projected; never Markdown,
 * credentials, owner IDs, private publishing mappings or search text.
 */
export function buildKnowledgeGraph(
  privateNotes:KnowledgeGraphNote[],
  privateRefs:KnowledgeGraphReference[],
):KnowledgeGraph{
  const nodes:KnowledgeGraphNote[]=[];
  const ids=new Set<string>();
  for(const n of privateNotes){
    if(!n||!UUID.test(n.id)||ids.has(n.id)||typeof n.slug!=="string"||
       typeof n.title!=="string"||typeof n.category!=="string")continue;
    ids.add(n.id);
    nodes.push({
      id:n.id,slug:n.slug,title:n.title,category:n.category,
      tags:Array.isArray(n.tags)?n.tags.filter(x=>typeof x==="string"):[],
    });
  }
  const targets=wikiTargetMap(nodes);
  const edgeKeys=new Set<string>();
  const edges:KnowledgeGraphEdge[]=[];
  let unresolvedCount=0;
  let hiddenReferenceCount=0;
  for(const ref of privateRefs){
    if(!ref||typeof ref.target_key!=="string"||typeof ref.source_note_id!=="string")continue;
    if(!ids.has(ref.source_note_id)){hiddenReferenceCount++;continue}
    const key=normalizeWikiKey(ref.target_key);
    if(!key){unresolvedCount++;continue;}
    const to=Object.hasOwn(targets,key)?targets[key]:undefined;
    if(!to){unresolvedCount++;continue}
    if(ref.source_note_id===to)continue;
    const pair=ref.source_note_id+"→"+to;
    if(edgeKeys.has(pair))continue;
    edgeKeys.add(pair);
    edges.push({source:ref.source_note_id,target:to});
  }
  return {nodes,edges,unresolvedCount,hiddenReferenceCount};
}

export type GraphPoint={id:string;x:number;y:number;distance:number;weight:number};
export type KnowledgeGraphLayout={points:GraphPoint[];edges:KnowledgeGraphEdge[];partial:boolean};
export const GRAPH_W=1000;
export const GRAPH_H=600;

function stableHash(value:string):number{
  let n=2166136261;
  for(let i=0;i<value.length;i++){
    n=Math.imul(n^value.charCodeAt(i),16777619);
  }
  return n>>>0;
}

/**
 * A bounded, deterministic constellation. No perpetual physics animation,
 * network requests or WebGL. Filtering and local-focus remain O(V + E).
 */
export function layoutKnowledgeGraph(
  graph:KnowledgeGraph,
  focusId:string|null=null,
  maxNodes=90,
):KnowledgeGraphLayout {
  const limit=Math.max(1,Math.min(180,Math.floor(maxNodes)||90));
  const byId=new Map(graph.nodes.map(n=>[n.id,n]));
  const neighbours=new Map(graph.nodes.map(n=>[n.id,new Set<string>()]));
  const degrees=new Map(graph.nodes.map(n=>[n.id,0]));
  for(const e of graph.edges){
    if(!byId.has(e.source)||!byId.has(e.target)||e.source===e.target)continue;
    neighbours.get(e.source)?.add(e.target);
    neighbours.get(e.target)?.add(e.source);
    degrees.set(e.source,(degrees.get(e.source)||0)+1);
    degrees.set(e.target,(degrees.get(e.target)||0)+1);
  }
  const focus=focusId&&byId.has(focusId)?focusId:null;
  const dist=new Map<string,number>();
  let selected:string[];
  if(focus){
    dist.set(focus,0);
    const queue=[focus];
    for(let i=0;i<queue.length;i++){
      const id=queue[i];
      if((dist.get(id)||0)>=2)continue;
      for(const neighbour of neighbours.get(id)||[]){
        if(dist.has(neighbour))continue;
        dist.set(neighbour,(dist.get(id)||0)+1);
        queue.push(neighbour);
      }
    }
    // Primary neighbours first; tie-break by relationship density and id.
    selected=[...dist.keys()].sort((a,b)=>
      (dist.get(a)||0)-(dist.get(b)||0) ||
      (degrees.get(b)||0)-(degrees.get(a)||0) ||
      a.localeCompare(b)
    ).slice(0,limit);
  }else{
    // Input order is most-recent first from the owner-scoped SQL query.
    selected=graph.nodes.slice(0,limit).map(n=>n.id);
    for(const id of selected)dist.set(id,0);
  }
  const included=new Set(selected);
  const visibleEdges=graph.edges.filter(e=>included.has(e.source)&&included.has(e.target));
  const partial=selected.length<graph.nodes.length ||
    (focus?selected.length<dist.size:false);
  const points:GraphPoint[]=[];
  const cx=GRAPH_W/2,cy=GRAPH_H/2;
  if(focus){
    const rings=[selected.filter(id=>id===focus),
      selected.filter(id=>dist.get(id)===1),
      selected.filter(id=>dist.get(id)===2)];
    for(let ring=0;ring<rings.length;ring++){
      const ids=rings[ring];
      if(ring===0){
        if(ids[0])points.push({id:ids[0],x:cx,y:cy,distance:0,weight:degrees.get(ids[0])||0});
        continue;
      }
      const count=ids.length;
      for(let i=0;i<count;i++){
        const turn=(i+(stableHash(focus)%100)/240)*2*Math.PI/Math.max(count,1);
        const radius=ring===1?175:265;
        points.push({
          id:ids[i],x:cx+Math.cos(turn)*radius,
          y:cy+Math.sin(turn)*radius*0.83,
          distance:ring,weight:degrees.get(ids[i])||0,
        });
      }
    }
  }else{
    // Category neighbourhoods are stable across changes. Avoid a noisy
    // infinite force simulation, especially for iPhone/reduced-motion users.
    const categories=[...new Set(selected.map(id=>byId.get(id)?.category||"未分類"))].sort();
    const clusters=new Map(categories.map(c=>[c,selected.filter(id=>byId.get(id)?.category===c)]));
    for(let i=0;i<categories.length;i++){
      const category=categories[i],nodes=clusters.get(category)||[];
      const theta=(i+0.5)*Math.PI*2/Math.max(1,categories.length)-Math.PI/2;
      const radius=categories.length===1?0:196;
      const gx=cx+Math.cos(theta)*radius,gy=cy+Math.sin(theta)*radius*0.82;
      for(let j=0;j<nodes.length;j++){
        const angle=j*2.399963229728653+((stableHash(category)%360)*Math.PI/180);
        const r=34+Math.sqrt(j)*21;
        points.push({
          id:nodes[j],x:Math.min(957,Math.max(43,gx+Math.cos(angle)*r)),
          y:Math.min(557,Math.max(43,gy+Math.sin(angle)*r)),
          distance:0,weight:degrees.get(nodes[j])||0,
        });
      }
    }
  }
  return {points,edges:visibleEdges,partial};
}

/** Readable alternative for keyboard / screen-reader navigation. */
export function connectedGraphNotes(graph:KnowledgeGraph,id:string):string[]{
  if(!graph.nodes.some(n=>n.id===id))return [];
  const ids=new Set<string>();
  for(const e of graph.edges){
    if(e.source===id)ids.add(e.target);
    if(e.target===id)ids.add(e.source);
  }
  return [...ids];
}
