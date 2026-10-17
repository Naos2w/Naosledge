import "server-only";
import { backend } from "@/lib/backend";
import { createClient } from "@/lib/supabase/server";
import { publicNeonClient } from "@/lib/neon/clients";
import type { createNeonDataApiClient } from "@/lib/neon/data-api";

/**
 * Both clients implement PostgREST .from() with the exact calls used here.
 * This boundary is intentionally typed once instead of unioning incompatible
 * upstream generic overloads across all server components.
 */
export type BlogQueryClient = ReturnType<typeof createNeonDataApiClient>;

export async function publicPostClient(): Promise<BlogQueryClient> {
  if (backend() === "neon") return publicNeonClient();
  return (await createClient()) as unknown as BlogQueryClient;
}
