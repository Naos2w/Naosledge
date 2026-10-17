import {notFound} from "next/navigation";
import OwnerActivationForm from "@/components/owner-activation-form";
import {ownerActivationConfig} from "@/lib/neon/owner-activation-server";

export const dynamic="force-dynamic";
export const metadata={title:"站長帳號啟用",robots:{index:false,follow:false}};
export default function OwnerActivationPage(){
  try{ownerActivationConfig();}catch{notFound();}
  return <OwnerActivationForm/>;
}
