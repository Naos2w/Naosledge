"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {ArrowRight,ShieldCheck} from "lucide-react";
import {completeOwnerFirstPassword} from "@/app/owner-activation/actions";
import {validOwnerResetToken} from "@/lib/neon/owner-activation";

export default function OwnerFirstPasswordForm(){
 const [token,setToken]=useState<string|null|undefined>(undefined);
 const [password,setPassword]=useState("");
 const [confirm,setConfirm]=useState("");
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [done,setDone]=useState(false);
 const tokenCaptured=useRef(false);

 useEffect(()=>{
   // React StrictMode deliberately replays Effects in development; never
   // override an already captured token after the URL was scrubbed.
   if(tokenCaptured.current)return;
   tokenCaptured.current=true;
   // Do not read token via server searchParams or serialize it in HTML/RSC.
   // Capture it client-side once and scrub URL/history immediately.
   const params=new URLSearchParams(window.location.search);
   const raw=params.getAll("token");
   const selected=raw.length===1&&validOwnerResetToken(raw[0])?raw[0]:null;
   window.history.replaceState(window.history.state,"",window.location.pathname);
   setToken(selected);
 },[]);

 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!token||busy||done)return;
  if(password!==confirm){setError("兩次輸入的密碼不一致。");return;}
  setBusy(true);setError("");
  try{
   const r=await completeOwnerFirstPassword(token,password);
   if(!r.ok)setError(r.message);
   else {
    setPassword("");setConfirm("");setToken(null);
    setDone(true);
   }
  }catch{setError("密碼設定服務暫時不可用。");}
  finally{setBusy(false);}
 }
 return <section className="login-page container">
   <form className="login-form" onSubmit={submit}>
     <span className="section-kicker">PRIVATE OWNER / CREDENTIAL SETUP</span>
     <h1>設定首次登入密碼。</h1>
     <p>僅接受 Neon Auth 核發的一次性連結。密碼由你自己輸入，並直接交給受管的 Neon Auth，不會寫入 GitHub 或 ChatGPT。</p>
     {done?<div role="status">
       <ShieldCheck size={25}/>
       <p>密碼已成功設定。下一步須確認 Email 已驗證，之後才能經人工授權進入管理工作室。</p>
       <Link href="/owner-activation" className="text-link">返回帳號啟用</Link>
     </div>:token===undefined?<p role="status">正在確認一次性連結…</p>
      :token===null?<p role="alert">連結無效或已過期。請從帳號啟用頁重新申請。</p>
      :<>
        <label htmlFor="owner-new-password">新密碼（至少 12 字元）</label>
        <input id="owner-new-password" type="password" autoComplete="new-password"
          minLength={12} maxLength={128} required value={password}
          onChange={e=>setPassword(e.target.value)}/>
        <label htmlFor="owner-confirm-password">再次確認密碼</label>
        <input id="owner-confirm-password" type="password" autoComplete="new-password"
          minLength={12} maxLength={128} required value={confirm}
          onChange={e=>setConfirm(e.target.value)}/>
        {error&&<p role="alert" className="form-error">{error}</p>}
        <button type="submit" className="button-primary login-submit" disabled={busy}>
          {busy?"設定中…":"設定新密碼"} <ArrowRight size={16}/>
        </button>
      </>}
     <p className="login-note">此頁沒有單獨授權任何網站管理功能。請勿將密碼或連結傳給其他人。</p>
   </form>
 </section>;
}
