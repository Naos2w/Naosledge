import { cache } from "react";
import { publicPostClient } from "@/lib/data/server";
import type { Post } from "@/lib/types";

export async function publishedPosts(): Promise<Post[]> {
  const supabase = await publicPostClient();
  const { data, error } = await supabase.from("posts").select("*")
    .eq("status", "published").order("updated_at", { ascending: false }).limit(300);
  if (error) throw new Error(`無法載入文章：${error.message}`);
  return (data || []) as Post[];
}

// De-duplicate Metadata + Page lookups within one React server request.
export const publishedPost = cache(async (slug: string): Promise<Post | null> => {
  const supabase = await publicPostClient();
  const { data, error } = await supabase.from("posts").select("*")
    .eq("status", "published").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`無法讀取文章：${error.message}`);
  return data as Post | null;
});
