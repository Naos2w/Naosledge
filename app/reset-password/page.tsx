import { notFound } from "next/navigation";
import { backend } from "@/lib/backend";
import { neonSandboxConfig } from "@/lib/neon/config";
import {productionReleaseIntent} from "@/lib/neon/production-release";
import { validRecoveryToken } from "@/lib/neon/password-recovery";
import PasswordRecoveryForm from "@/components/password-recovery-form";

export const dynamic = "force-dynamic";
export const metadata = {title:"設定站長密碼", robots:{index:false,follow:false}};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{token?:string | string[];error?:string | string[]}>;
}) {
  if (productionReleaseIntent(process.env)) notFound();
  if (backend() !== "neon") notFound();
  neonSandboxConfig();
  const params = await searchParams;
  const token = validRecoveryToken(params.token) ? params.token : null;
  return <section className="login-page container">
    <PasswordRecoveryForm mode="reset" token={token}/>
  </section>;
}
