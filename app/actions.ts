"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { isPostId, validatePostInput } from "@/lib/post-validation";
import { backend } from "@/lib/backend";
import { neonAuth } from "@/lib/neon/auth-server";
import {privateVaultPreviewIntent} from "@/lib/neon/vault-preview";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function savePost(input: unknown): Promise<ActionResult> {
  if(privateVaultPreviewIntent(process.env))return {ok:false,error:"私人驗收站禁止建立或發布公開文章。"};
  const { supabase, user } = await requireAdmin();
  const validated = validatePostInput(input);
  if (!validated.ok) return validated;

  const { id, title, slug, excerpt, content_md, category, tags, learned_on, status } = validated.value;
  let previouslyPublishedAt: string | null = null;
  let previousSlug: string | null = null;
  if (id) {
    const { data, error } = await supabase.from("posts").select("published_at,slug")
      .eq("id", id).eq("author_id", user.id).maybeSingle();
    if (error || !data) return {ok:false,error:"找不到可編輯文章。"};
    previouslyPublishedAt = data.published_at;
    previousSlug = data.slug;
  }

  const payload = {
    title, slug, excerpt, content_md, category, tags, status, learned_on,
    published_at: status === "published" ? (previouslyPublishedAt ?? new Date().toISOString()) : null,
  };
  const result = id
    ? await supabase.from("posts").update(payload).eq("id", id).eq("author_id", user.id).select("id").single()
    : await supabase.from("posts").insert({ ...payload, author_id: user.id }).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") return {ok:false,error:"這個文章網址已存在，請換一個 slug。"};
    return {ok:false,error:`儲存失敗：${result.error.message}`};
  }
  revalidatePath("/");
  revalidatePath(`/notes/${slug}`);
  if (previousSlug && previousSlug !== slug) revalidatePath(`/notes/${previousSlug}`);
  revalidatePath("/studio");
  return {ok:true,id:result.data.id as string};
}

export async function deletePost(id: unknown): Promise<{ok:boolean;error?:string}> {
  if(privateVaultPreviewIntent(process.env))return {ok:false,error:"私人驗收站禁止刪除公開文章。"};
  const { supabase, user } = await requireAdmin();
  if (!isPostId(id)) return {ok:false,error:"無效的文章 ID。"};
  const { error } = await supabase.from("posts").delete().eq("id", id).eq("author_id", user.id);
  if (error) return {ok:false,error:error.message};
  revalidatePath("/");
  revalidatePath("/studio");
  return {ok:true};
}

export async function signOut() {
  if (backend() === "neon") {
    await neonAuth().signOut();
    redirect(privateVaultPreviewIntent(process.env)?"/login":"/");
  }
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
