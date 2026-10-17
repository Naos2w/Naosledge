import { redirect } from "next/navigation";
import StudioLogin from "@/components/studio-login";
import { checkAdmin } from "@/lib/auth";
import {privateVaultPreviewIntent,validatePrivateVaultPreview} from "@/lib/neon/vault-preview";
export const dynamic = "force-dynamic";
export const metadata = {title:"站長登入",robots:{index:false,follow:false}};
export default async function Login() {
  const vaultOnly=privateVaultPreviewIntent(process.env);
  if(vaultOnly)validatePrivateVaultPreview(process.env);
  if (await checkAdmin()) redirect(vaultOnly?"/vault":"/studio");
  return <section className="login-page container">
    <StudioLogin afterLogin={vaultOnly?"/vault":"/studio"} hideRecovery={vaultOnly}/>
  </section>;
}
