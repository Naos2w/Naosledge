"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { requestNeonPasswordReset, completeNeonPasswordReset } from "@/app/neon-auth-actions";

type Props =
  | { mode: "request" }
  | { mode: "reset"; token: string | null };

export default function PasswordRecoveryForm(props: Props) {
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [confirm,setConfirm] = useState("");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [done,setDone] = useState(false);

  const isReset = props.mode === "reset";
  const token = isReset ? props.token : null;

  // Better Auth returns its single-use token in the callback query string.
  // Keep it in React state only; remove it from the visible URL/history after
  // hydration so a user cannot accidentally copy it into support messages.
  useEffect(() => {
    if (isReset && window.location.search) {
      window.history.replaceState(window.history.state, "", "/reset-password");
    }
  }, [isReset]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || done) return;
    setError("");
    setBusy(true);
    try {
      if (props.mode === "request") {
        const result = await requestNeonPasswordReset(email.trim());
        if (!result.ok) setError(result.error || "暫時無法寄出重設信。");
        else setDone(true);
        return;
      }
      if (!token) {
        setError("重設連結無效或已過期，請重新申請。");
        return;
      }
      if (password !== confirm) {
        setError("兩次輸入的密碼不一致。");
        return;
      }
      const result = await completeNeonPasswordReset(token, password);
      if (!result.ok) setError(result.error || "密碼重設失敗。");
      else {
        setPassword("");
        setConfirm("");
        setDone(true);
      }
    } catch {
      setError("目前無法處理，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="login-form">
    <span className="section-kicker">PRIVATE STUDIO / 帳號安全</span>
    <h1>{isReset ? "設定新密碼。" : "找回登入權限。"}</h1>
    <p>{isReset
      ? "請使用安全的獨立密碼。密碼設定成功不等於取得站長發文權限。"
      : "填入帳號 Email；若帳號存在，系統會寄送一次性的密碼設定連結。"}</p>

    {done ? <div role="status">
      <p>{isReset
        ? "密碼已設定完成。待站長權限核准後，才能進入寫作工作室。"
        : "若這個 Email 已建立帳號，請檢查收件匣及垃圾郵件匣中的重設通知。"}</p>
      <Link className="text-link" href="/login">返回登入頁</Link>
    </div> : <>
      {isReset ? (
        token ? <>
          <label htmlFor="new-password">新密碼（至少 12 字元）</label>
          <input id="new-password" autoComplete="new-password" type="password"
            required minLength={12} maxLength={128} value={password}
            onChange={e=>setPassword(e.target.value)}/>
          <label htmlFor="confirm-password">再次確認新密碼</label>
          <input id="confirm-password" autoComplete="new-password" type="password"
            required minLength={12} maxLength={128} value={confirm}
            onChange={e=>setConfirm(e.target.value)}/>
        </> : <p role="alert">重設連結無效或已過期，請重新申請。</p>
      ) : <>
        <label htmlFor="recovery-email">電子郵件</label>
        <input id="recovery-email" autoComplete="email" type="email"
          required maxLength={256} value={email}
          onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {(!isReset || token) && <button className="button-primary login-submit"
        type="submit" disabled={busy}>
        {busy ? "處理中…" : isReset ? "設定新密碼" : "寄送設定連結"} <ArrowRight size={17}/>
      </button>}
      <p className="login-note">
        <Link className="text-link" href={isReset ? "/forgot-password" : "/login"}>
          {isReset ? "重新申請密碼設定連結" : "返回站長登入"}
        </Link>
      </p>
    </>}
  </form>;
}
