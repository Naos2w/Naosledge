import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { backend } from "@/lib/backend";
import { neonAuth } from "@/lib/neon/auth-server";
import { memberNeonClient } from "@/lib/neon/clients";
import type { BlogQueryClient } from "@/lib/data/server";

type AdminUser = {id: string; email?: string | null};
type AdminContext = {supabase: BlogQueryClient; user: AdminUser};

export async function checkAdmin(): Promise<AdminContext | null> {
  if (backend() === "neon") {
    const {data: session, error} = await neonAuth().getSession();
    if (error || !session?.user) return null;
    try {
      const user = session.user;
      // A signed-in user is not implicitly an admin. DB RLS verifies the
      // actual Neon-issued JWT and permits reading only one's own admin row.
      const supabase = await memberNeonClient(user.id);
      const result = await supabase.from("blog_admins")
        .select("user_id").eq("user_id", user.id).maybeSingle();
      return !result.error && result.data ? {supabase, user} : null;
    } catch {
      return null;
    }
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const result = await supabase.from("blog_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return !result.error && result.data
    ? {supabase: supabase as unknown as BlogQueryClient, user} : null;
}

export async function requireAdmin(): Promise<AdminContext> {
  const admin = await checkAdmin();
  if (!admin) redirect("/login");
  return admin;
}
