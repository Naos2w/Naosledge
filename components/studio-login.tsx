"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function StudioLogin() {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  async function login(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const supabase = createClient();
      const { data: signedIn, error: authError } = await supabase.auth.signInWithPassword({email,password});
      if (authError || !signedIn.user) {
        setError("登入失敗，請確認管理員帳號與密碼。");
        return;
      }
      // A successful sign-in is not the same as authorization to publish posts.
      // Read is restricted to the signed-in user's own admin row by RLS.
      const { data: admin, error: adminError } = await supabase
        .from("blog_admins")
        .select("user_id")
        .eq("user_id", signedIn.user.id)
        .maybeSingle();
      if (adminError || !admin) {
        await supabase.auth.signOut();
        setError("此帳號沒有站長權限，請改用授權的管理員帳號登入。");
        return;
      }
      window.location.assign("/studio");
    } catch {setError("連線失敗，請稍後重試。");}
    finally {setBusy(false);}
  }
  return <form onSubmit={login} className="login-form">
    <span className="section-kicker">PRIVATE STUDIO / 僅限站長</span>
    <h1>回到你的<br/>寫作桌。</h1><p>登入後，可以整理、修改與發布學習筆記。</p>
    <label htmlFor="email">電子郵件</label><input id="email" type="email" required autoComplete="username" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/>
    <label htmlFor="password">密碼</label><input id="password" type="password" required autoComplete="current-password" placeholder="輸入密碼" value={password} onChange={e=>setPassword(e.target.value)}/>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <button className="button-primary login-submit" disabled={busy} type="submit">{busy?"登入中…":"進入工作室"}<ArrowRight size={17}/></button>
    <div className="login-note">這裡只開放站長登入，沒有公開註冊。</div>
  </form>;
}
