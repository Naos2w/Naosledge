import {notFound} from "next/navigation";
import OwnerFirstPasswordForm from "@/components/owner-first-password-form";
import {ownerActivationConfig} from "@/lib/neon/owner-activation-server";

export const dynamic="force-dynamic";
export const metadata={title:"設定站長密碼",robots:{index:false,follow:false}};
export default function OwnerActivationResetPage(){
  try{ownerActivationConfig();}catch{notFound();}
  // The reset token is NOT a server prop or React Server Component payload.
  return <OwnerFirstPasswordForm/>;
}
