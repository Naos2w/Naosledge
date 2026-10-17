/** Backend switching is opt-in, with an additional Vercel Production guard. */
import {productionReleaseIntent,validateProductionRelease} from "./neon/production-release.ts";
export type Backend = "supabase" | "neon";

export function backend(): Backend {
  // Backstop for Server Actions and data callers outside the normal proxy:
  // Production must never silently fall back to a historical Supabase client.
  if(productionReleaseIntent(process.env))validateProductionRelease(process.env);
  const value = process.env.NAOSLEDGE_BACKEND || "supabase";
  if (value !== "supabase" && value !== "neon") {
    throw new Error("NAOSLEDGE_BACKEND 必須是 supabase 或 neon。");
  }
  const uiMode = process.env.NEXT_PUBLIC_NAOSLEDGE_BACKEND || "supabase";
  if (uiMode !== value) {
    throw new Error("網站與伺服器的後端模式不一致，已拒絕連線。");
  }
  return value;
}
