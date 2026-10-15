import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function checkAdmin() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const result = await supabase.from("blog_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return !result.error && result.data ? { supabase, user } : null;
}

export async function requireAdmin() {
  const admin = await checkAdmin();
  if (!admin) redirect("/login");
  return admin;
}
