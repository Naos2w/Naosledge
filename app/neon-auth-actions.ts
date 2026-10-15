"use server";

import { backend } from "@/lib/backend";
import { neonAuth } from "@/lib/neon/auth-server";
import { checkAdmin } from "@/lib/auth";

/** Official Neon Auth SDK sets HTTP-only session cookies in this Server Action. */
export async function signInNeon(email: string, password: string): Promise<{ok: boolean; error?: string}> {
  if (backend() !== "neon") return {ok:false,error:"Neon 登入尚未啟用。"};
  if (typeof email !== "string" || typeof password !== "string" ||
      email.length > 256 || password.length > 1024 || !email.includes("@") || !password) {
    return {ok:false,error:"請輸入有效的電子郵件與密碼。"};
  }
  try {
    const {error} = await neonAuth().signIn.email({email, password});
    if (error) return {ok:false,error:"登入失敗，請確認管理員帳號與密碼。"};
    return {ok:true};
  } catch {
    return {ok:false,error:"Neon Auth 暫時無法連線。"};
  }
}

/** Separate request: cookie is present in the browser, so DB RLS can verify role. */
export async function confirmNeonAdmin(): Promise<{ok:boolean;error?:string}> {
  if (backend() !== "neon") return {ok:false,error:"Neon 登入尚未啟用。"};
  const user = await checkAdmin();
  if (user) return {ok:true};
  try { await neonAuth().signOut(); } catch { /* deny access anyway */ }
  return {ok:false,error:"此帳號沒有站長權限，請改用授權的管理員帳號登入。"};
}
