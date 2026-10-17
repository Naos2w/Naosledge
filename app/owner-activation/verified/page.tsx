import Link from "next/link";
import {notFound} from "next/navigation";
import {ShieldCheck} from "lucide-react";
import {ownerActivationConfig} from "@/lib/neon/owner-activation-server";

export const dynamic="force-dynamic";
export const metadata={title:"Email 驗證流程",robots:{index:false,follow:false}};
export default function OwnerActivationVerifiedPage(){
  try{ownerActivationConfig();}catch{notFound();}
  return <section className="login-page container"><div className="login-form">
    <span className="section-kicker">PRIVATE OWNER / EMAIL VERIFICATION</span>
    <h1>信箱驗證流程。</h1>
    <ShieldCheck size={28}/>
    <p>驗證通知已開啟。這個返回頁不代表 Email 已通過確認；必須以 Neon Auth 官方帳號的實際驗證狀態為準。</p>
    <p>請回到站長帳號啟用頁完成密碼設定。無論顯示什麼結果，本頁都不會直接賦予站長權限。</p>
    <Link href="/owner-activation" className="text-link">返回帳號啟用</Link>
  </div></section>;
}
