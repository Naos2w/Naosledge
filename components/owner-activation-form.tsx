"use client";

import {useState} from "react";
import Link from "next/link";
import {ArrowRight,MailCheck,KeyRound,ShieldCheck} from "lucide-react";
import {
 requestOwnerVerificationEmail,requestOwnerFirstPasswordEmail,
 confirmOwnerEmailOtp,
} from "@/app/owner-activation/actions";

export default function OwnerActivationForm(){
 const [busy,setBusy]=useState<"verification"|"password"|"otp"|null>(null);
 const [otp,setOtp]=useState("");
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");

 async function handle(kind:"verification"|"password"){
  if(busy)return;
  if(!window.confirm(kind==="verification"
     ?"向原有站長信箱申請官方 Email 驗證通知？"
     :"向原有站長信箱申請一次性首次設定密碼連結？"))return;
  setBusy(kind);setMessage("");setError("");
  try{
   const r=kind==="verification"
     ?await requestOwnerVerificationEmail()
     :await requestOwnerFirstPasswordEmail();
   if(r.ok)setMessage(r.message);
   else setError(r.message);
  }catch{
   setError("服務暫時無法使用。請確認受保護的 HTTPS Preview 是否已設定。");
  }finally{setBusy(null);}
 }
 async function verifyCode(){
   if(busy)return;
   setBusy("otp");setMessage("");setError("");
   try{
     const r=await confirmOwnerEmailOtp(otp.trim());
     if(r.ok){setOtp("");setMessage(r.message);}
     else setError(r.message);
   }catch{setError("暫時無法確認驗證碼，請稍後再試。");}
   finally{setBusy(null);}
 }
 return <section className="login-page container">
   <div className="login-form">
     <span className="section-kicker">NAOSLEDGE / PRIVATE OWNER</span>
     <h1>啟用站長帳號。</h1>
     <p>此頁僅連接 Neon 官方託管 Auth，不讀取網站筆記資料庫，也不會直接賦予任何站長權限。</p>
     <p>所有驗證與密碼設定通知只寄到已建立的站長帳號信箱。請自行在信箱內完成操作，勿向任何人提供密碼、驗證碼或完整連結。</p>
     <div style={{display:"grid",gap:12,marginTop:20}}>
       <button className="button-primary login-submit" type="button"
          disabled={busy!==null} onClick={()=>void handle("verification")}>
          <MailCheck size={17}/>{busy==="verification"?"申請中…":"1. 寄送 Email 驗證通知"}<ArrowRight size={15}/>
       </button>
       <div className="login-note">
         <label htmlFor="owner-verification-otp">若驗證信提供數字驗證碼，可在此輸入（請勿傳到聊天）</label>
         <input id="owner-verification-otp" type="text" inputMode="numeric"
           autoComplete="one-time-code" pattern="[0-9]{4,12}" maxLength={12}
           value={otp} onChange={e=>setOtp(e.target.value.replace(/[^0-9]/g,""))}
           placeholder="驗證碼" />
         <button className="button-primary login-submit" type="button"
           disabled={busy!==null||otp.length<4} onClick={()=>void verifyCode()}>
           {busy==="otp"?"驗證中…":"確認 Email 驗證碼"}
         </button>
       </div>
       <button className="button-primary login-submit" type="button"
          disabled={busy!==null} onClick={()=>void handle("password")}>
          <KeyRound size={17}/>{busy==="password"?"申請中…":"2. 申請首次設定密碼連結"}<ArrowRight size={15}/>
       </button>
     </div>
     {message&&<p role="status">{message}</p>}
     {error&&<p className="form-error" role="alert">{error}</p>}
     <p className="login-note"><ShieldCheck size={14} style={{display:"inline",verticalAlign:"middle"}}/> Email／密碼都須完成受信任驗證；任何信件操作不會自動批准站長身份。</p>
     <Link href="/login" className="text-link">返回登入頁</Link>
   </div>
 </section>;
}
