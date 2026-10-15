/** Backend switching is opt-in. Existing Supabase code remains the default. */
export type Backend = "supabase" | "neon";

export function backend(): Backend {
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
