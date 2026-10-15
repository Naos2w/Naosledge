"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import type { PostInput } from "@/lib/types";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string };

export async function savePost(input: PostInput): Promise<ActionResult> {
  const { supabase, user } = await requireAdmin();
  const title = input.title.trim();
  const slug = input.slug.trim().toLowerCase();
  const excerpt = input.excerpt.trim();
  const content_md = input.content_md;
  const category = input.category.trim() || "筆記";
  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];
  if (!title || title.length > 160) return {ok:false,error:"標題請填寫 1～160 個字。"};
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 120)
    return {ok:false,error:"文章網址限 3～120 字的小寫英文、數字與連字號。"};
  if (excerpt.length > 400) return {ok:false,error:"摘要不可超過 400 字。"};
  if (category.length > 36) return {ok:false,error:"分類不可超過 36 字。"};
  if (tags.length > 12 || tags.some((tag)=>tag.length > 28)) return {ok:false,error:"標籤最多 12 個，每個最多 28 字。"};
  const date = new Date(`${input.learned_on}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.learned_on) ||
      Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== input.learned_on)
    return {ok:false,error:"請選擇有效的學習日期。"};
  if (input.status !== "draft" && input.status !== "published") return {ok:false,error:"狀態不正確。"};
  if (input.status === "published" && content_md.trim().length < 10)
    return {ok:false,error:"發布前請至少輸入 10 個字的正文。"};

  let previouslyPublishedAt: string | null = null;
  if (input.id) {
    if (!/^[a-f0-9-]{36}$/i.test(input.id)) return {ok:false,error:"無效的文章 ID。"};
    const { data, error } = await supabase.from("posts").select("published_at")
      .eq("id", input.id).eq("author_id", user.id).maybeSingle();
    if (error || !data) return {ok:false,error:"找不到可編輯文章。"};
    previouslyPublishedAt = data.published_at;
  }

  const payload = {
    title, slug, excerpt, content_md, category, tags,
    status: input.status, learned_on: input.learned_on,
    published_at: input.status === "published" ? (previouslyPublishedAt ?? new Date().toISOString()) : null,
  };
  const result = input.id
    ? await supabase.from("posts").update(payload).eq("id", input.id).eq("author_id", user.id).select("id").single()
    : await supabase.from("posts").insert({ ...payload, author_id: user.id }).select("id").single();
  if (result.error) {
    if (result.error.code === "23505") return {ok:false,error:"這個文章網址已存在，請換一個 slug。"};
    return {ok:false,error:`儲存失敗：${result.error.message}`};
  }
  revalidatePath("/");
  revalidatePath(`/notes/${slug}`);
  revalidatePath("/studio");
  return {ok:true,id:result.data.id as string};
}

export async function deletePost(id: string): Promise<{ok:boolean;error?:string}> {
  const { supabase, user } = await requireAdmin();
  if (!/^[a-f0-9-]{36}$/i.test(id)) return {ok:false,error:"無效的文章 ID。"};
  const { error } = await supabase.from("posts").delete().eq("id", id).eq("author_id", user.id);
  if (error) return {ok:false,error:error.message};
  revalidatePath("/");
  revalidatePath("/studio");
  return {ok:true};
}

export async function signOut() {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
