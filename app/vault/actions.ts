"use server";

import {revalidatePath} from "next/cache";
import {requireVault, privateVaultNote} from "@/lib/vault-server";
import {isKnowledgeId,validateVaultNote,publicDraftMarkdown} from "@/lib/vault-validation";

type ActionResult={ok:true;id:string}|{ok:false;error:string};

export async function saveVaultNote(input:unknown):Promise<ActionResult> {
  const {supabase}=await requireVault();
  const checked=validateVaultNote(input);
  if(!checked.ok) return checked;
  const data=checked.value;
  try {
    const result=await supabase.rpc("save_knowledge_note",{
      p_id:data.id||null, p_title:data.title, p_slug:data.slug,
      p_summary:data.summary, p_content_md:data.content_md,
      p_category:data.category, p_tags:data.tags,
      p_learned_on:data.learned_on, p_links:data.links,
    });
    if(result.error) {
      return {ok:false,error:result.error.code==="23505"?
        "這個私人筆記識別碼已經存在，請改用其他 slug。":
        "私人筆記無法儲存；請確認 Vault Migration 已就緒。"};
    }
    const id=result.data;
    if(!isKnowledgeId(id)) return {ok:false,error:"資料庫沒有回傳有效的筆記識別碼。"};
    revalidatePath("/vault");
    revalidatePath(`/vault/${id}`);
    return {ok:true,id};
  } catch {
    return {ok:false,error:"儲存失敗，請檢查登入狀態與網路後再試。"};
  }
}

export async function deleteVaultNote(id:unknown):Promise<{ok:boolean;error?:string}> {
  const {supabase,user}=await requireVault();
  if(!isKnowledgeId(id)) return {ok:false,error:"私人筆記識別碼無效。"};
  try {
    const {data,error}=await supabase.from("knowledge_notes").delete()
      .eq("id",id).eq("owner_id",user.id).select("id").maybeSingle();
    if(error || !data) return {ok:false,error:"找不到這篇可刪除的私人筆記。"};
    // A separately reviewed public snapshot is never deleted automatically.
    revalidatePath("/vault");
    revalidatePath(`/vault/${id}`);
    return {ok:true};
  } catch {
    return {ok:false,error:"刪除失敗，請稍後再試。"};
  }
}

export async function createVaultPublicDraft(
  id:unknown, publicSlug:unknown,
):Promise<ActionResult> {
  const context=await requireVault();
  if(!isKnowledgeId(id) || typeof publicSlug!=="string" ||
      publicSlug.length>120 || publicSlug.length<3 ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(publicSlug)) {
    return {ok:false,error:"請輸入有效的公開文章網址識別碼。"};
  }
  const note=await privateVaultNote(context,id);
  if(!note) return {ok:false,error:"找不到原始私人筆記。"};
  try {
    // Read the source on the server. Never trust client-provided note contents.
    // Existing posts are NOT auto-published: RPC creates status=draft only.
    const {data,error}=await context.supabase.rpc("create_knowledge_public_draft",{
      p_note_id:id,p_public_slug:publicSlug,
      p_review_content_md:publicDraftMarkdown(note.content_md),
    });
    if(error) return {ok:false,error:error.code==="23505"?
      "這個公開草稿網址已經被使用，請更換。":
      "無法建立公開草稿，請確認 Migration 與權限。"};
    if(!isKnowledgeId(data)) return {ok:false,error:"公開草稿沒有回傳有效識別碼。"};
    revalidatePath("/studio");
    return {ok:true,id:data};
  } catch {
    return {ok:false,error:"建立公開草稿失敗，請稍後重試。"};
  }
}
