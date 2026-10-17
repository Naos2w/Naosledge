import "server-only";

import {notFound} from "next/navigation";
import {backend} from "@/lib/backend";
import {requireAdmin} from "@/lib/auth";
import {isKnowledgeId} from "@/lib/vault-validation";
import {wikiTargetMap} from "@/lib/wiki-links";
import type {KnowledgeTitle} from "@/lib/wiki-links";

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
  return (result.data||[]) as unknown as VaultNoteSummary[];
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
