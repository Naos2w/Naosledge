import { notFound } from "next/navigation";
import { backend } from "@/lib/backend";
import { neonSandboxConfig } from "@/lib/neon/config";
import PasswordRecoveryForm from "@/components/password-recovery-form";

export const dynamic = "force-dynamic";
export const metadata = {title:"找回站長密碼", robots:{index:false,follow:false}};

export default function ForgotPasswordPage() {
  if (backend() !== "neon") notFound();
  neonSandboxConfig();
  return <section className="login-page container"><PasswordRecoveryForm mode="request"/></section>;
}
