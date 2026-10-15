/**
 * Anonymous, read-only Supabase smoke check. Run after a dedicated Naosledge
 * project has been initialized:
 *
 *   node --env-file=.env.local scripts/verify-anonymous-access.mjs
 *
 * Optionally set NAOSLEDGE_DRAFT_TEST_SLUG to the slug of a real draft that
 * the owner created for testing. No credentials or article bodies are printed.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishable || /YOUR_PROJECT|YOUR_KEY/.test(url + publishable)) {
    throw new Error("Missing actual Supabase URL or publishable key in .env.local");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Expected an HTTPS Supabase API URL");
  }

  const anon = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // No sign-in and no service-role token: this is the public browser's view.
  const posts = await anon.from("posts").select("id,slug,status").limit(300);
  if (posts.error) {
    throw new Error(`Public articles query failed (code: ${posts.error.code || "unknown"})`);
  }
  if (posts.data?.some((p) => p.status !== "published")) {
    throw new Error("SECURITY FAILURE: anonymous visitor can read a non-published article");
  }
  console.log(`PASS: anonymous post query returned ${posts.data?.length ?? 0} public rows (max 300 checked)`);

  // Admin UUIDs must never be enumerable through a publishable key.
  const admins = await anon.from("blog_admins").select("user_id").limit(1);
  if ((admins.data?.length ?? 0) > 0) {
    throw new Error("SECURITY FAILURE: anonymous visitor can read blog_admins");
  }
  if (admins.error && admins.error.code !== "42501") {
    throw new Error(`Could not verify admin visibility (code: ${admins.error.code || "unknown"})`);
  }
  console.log("PASS: anonymous visitor cannot read an admin ID");

  const draftSlug = process.env.NAOSLEDGE_DRAFT_TEST_SLUG;
  if (draftSlug) {
    const draft = await anon.from("posts").select("id").eq("slug", draftSlug).limit(1);
    if (draft.error) throw new Error(`Draft isolation request failed (code: ${draft.error.code || "unknown"})`);
    if ((draft.data?.length ?? 0) !== 0) {
      throw new Error("SECURITY FAILURE: anonymous visitor can read the named draft");
    }
    console.log("PASS: named draft is invisible to anonymous visitors");
  } else {
    console.log("NOT VERIFIED: draft isolation needs NAOSLEDGE_DRAFT_TEST_SLUG and a real draft fixture");
  }
  console.log("NOTE: read-only smoke checks do not prove that authenticated write policies are correct");
}

main().catch((error) => {
  console.error("FAIL:", error instanceof Error ? error.message : "anonymous access check failed");
  process.exitCode = 1;
});
