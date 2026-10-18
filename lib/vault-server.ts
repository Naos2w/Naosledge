import "server-only";

import {notFound} from "next/navigation";
import {backend} from "@/lib/backend";
import {requireAdmin} from "@/lib/auth";
import {isKnowledgeId} from "@/lib/vault-validation";
import {wikiTargetMap} from "@/lib/wiki-links";
import type {KnowledgeTitle} from "@/lib/wiki-links";
import {buildKnowledgeGraph,type KnowledgeGraph,type KnowledgeGraphNote} from "@/lib/knowledge-graph";
import {graphNoteIdBatches,selectGraphReferences,type DatedGraphReference} from "@/lib/vault-graph-queries";
import {rankVaultSearchResults} from "@/lib/vault-search-rank";

export type VaultContext = Awaited<ReturnType<typeof requireAdmin>>;
export type VaultNote = {
  id:string;owner_id:string;slug:string;title:string;summary:string;
  content_md:string;category:string;tags:string[];
  learned_on:string;created_at:string;updated_at:string;
};
export type VaultNoteSummary = Pick<VaultNote,
  "id"|"slug"|"title"|"summary"|"category"|"tags"|"learned_on"|"updated_at">;
export type VaultRelation = {
  note:VaultNoteSummary; key:string; kind:"outgoing"|"backlink";
};
const LIST_FIELDS="id,slug,title,summary,category,tags,learned_on,updated_at";

export async function requireVault():Promise<VaultContext> {
  // Supabase compatibility and Production deployments cannot use the new
  // private schema. Explicit Neon Auth and admin RLS are always required.
  if(backend()!=="neon") notFound();
  return requireAdmin();
}

function vaultReadError():Error {
  return new Error("Private Vault 尚未完成資料庫 Migration 或暫時無法連線。原有公開網站不受影響。");
}

export async function searchVaultNotes(
  {supabase,user}:VaultContext, query="",
):Promise<VaultNoteSummary[]> {
  const q=query.trim().slice(0,120);
  const result=q
    ? await supabase.rpc("search_knowledge_notes",{p_query:q,p_limit:100})
        .select(LIST_FIELDS)
    : await supabase.from("knowledge_notes").select(LIST_FIELDS)
        .eq("owner_id",user.id).order("updated_at",{ascending:false}).limit(100);
  if(result.error) throw vaultReadError();
  const notes=(result.data||[]) as unknown as VaultNoteSummary[];
  // Only reorder already-retrieved, JWT/RLS-authorized RPC results.
  // Never expand the query or load extra private Markdown for ranking.
  return q?rankVaultSearchResults(notes,q):notes;
}

export async function listVaultTitles({supabase,user}:VaultContext):Promise<KnowledgeTitle[]> {
  const {data,error}=await supabase.from("knowledge_notes").select("id,slug,title")
    .eq("owner_id",user.id).order("updated_at",{ascending:false}).limit(500);
  if(error) throw vaultReadError();
  return (data||[]) as KnowledgeTitle[];
}

export async function privateVaultNote(
  {supabase,user}:VaultContext, id:string,
):Promise<VaultNote|null> {
  if(!isKnowledgeId(id)) return null;
  const {data,error}=await supabase.from("knowledge_notes").select(
    "id,owner_id,slug,title,summary,content_md,category,tags,learned_on,created_at,updated_at",
  ).eq("id",id).eq("owner_id",user.id).maybeSingle();
  if(error) throw vaultReadError();
  return (data||null) as VaultNote|null;
}

export async function vaultRelations(
  {supabase,user}:VaultContext,
  note:VaultNote,
  titles:KnowledgeTitle[],
):Promise<{outgoing:VaultRelation[];backlinks:VaultRelation[];unresolved:string[]}> {
  // Limit relationship rendering; the SQL side can scale with the owner +
  // source/target indexes. Do not ever query another owner's relationships.
  const {data,error}=await supabase.from("knowledge_links")
    .select("source_note_id,target_key")
    .eq("owner_id",user.id).limit(3000);
  if(error) throw vaultReadError();
  const edges=(data||[]) as {source_note_id:string;target_key:string}[];
  const lookup=wikiTargetMap(titles);
  const byId=new Map(titles.map(n=>[n.id,n]));
  const noteSummary=(n:KnowledgeTitle):VaultNoteSummary=>({
    id:n.id,title:n.title,slug:n.slug,summary:"",category:"",tags:[],
    learned_on:"",updated_at:"",
  });
  const outgoing:VaultRelation[]=[];
  const backlinks:VaultRelation[]=[];
  const unresolved:string[]=[];
  for(const edge of edges) {
    const targetId=lookup[edge.target_key];
    if(edge.source_note_id===note.id) {
      const target=targetId?byId.get(targetId):undefined;
      if(target) outgoing.push({kind:"outgoing",note:noteSummary(target),key:edge.target_key});
      else unresolved.push(edge.target_key);
    }
    if(targetId===note.id && edge.source_note_id!==note.id) {
      const source=byId.get(edge.source_note_id);
      if(source) backlinks.push({kind:"backlink",note:noteSummary(source),key:edge.target_key});
    }
  }
  return {outgoing,backlinks,unresolved};
}

/**
 * Private P3 graph snapshot. Both queries use the same authenticated member
 * JWT, explicit owner_id and Neon RLS. Only metadata/keys are ever serialized
 * to the browser — never Markdown, unpublished article mappings or secrets.
 *
 * Bounded for a Hobby-scale deployment; limits are visibly disclosed in UI.
 */
export type VaultGraphSnapshot={
  graph:KnowledgeGraph;
  notesTruncated:boolean;
  linksTruncated:boolean;
};

export async function loadVaultGraph({supabase,user}:VaultContext):Promise<VaultGraphSnapshot>{
  const NODE_LIMIT=180;
  const LINK_LIMIT=2400;
  const noteResult=await supabase.from("knowledge_notes")
    .select("id,slug,title,category,tags")
    .eq("owner_id",user.id)
    .order("updated_at",{ascending:false})
    .limit(NODE_LIMIT+1);
  if(noteResult.error)throw vaultReadError();
  const fetched=(noteResult.data||[]) as KnowledgeGraphNote[];
  const notesTruncated=fetched.length>NODE_LIMIT;
  const notes=fetched.slice(0,NODE_LIMIT);
  if(!notes.length){
    return {
      graph:buildKnowledgeGraph([],[]),
      notesTruncated:false,linksTruncated:false,
    };
  }
  // PostgREST `in.(uuid,...)` is a GET URL filter. At 180 UUIDs the
  // request can exceed common proxy URL limits; use four bounded batches.
  // Each batch retains its newest LIMIT+1 so merging still yields the
  // globally most recent links, not only links from the first batch.
  const batches=graphNoteIdBatches(notes.map(n=>n.id));
  const results=await Promise.all(batches.map(ids=>
    supabase.from("knowledge_links")
      .select("source_note_id,target_key,created_at")
      .eq("owner_id",user.id)
      .in("source_note_id",ids)
      .order("created_at",{ascending:false})
      .order("source_note_id",{ascending:true})
      .order("target_key",{ascending:true})
      .limit(LINK_LIMIT+1)
  ));
  if(results.some(r=>r.error))throw vaultReadError();
  const {references,truncated:linksTruncated}=selectGraphReferences(
    results.map(r=>(r.data||[]) as DatedGraphReference[]),LINK_LIMIT
  );
  return {
    graph:buildKnowledgeGraph(notes,references),
    notesTruncated,linksTruncated,
  };
}
