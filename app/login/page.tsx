import { redirect } from "next/navigation";
import StudioLogin from "@/components/studio-login";
import { checkAdmin } from "@/lib/auth";
export const metadata = {title:"站長登入",robots:{index:false,follow:false}};
export default async function Login() {
  if (await checkAdmin()) redirect("/studio");
  return <section className="login-page container"><StudioLogin/></section>;
}
