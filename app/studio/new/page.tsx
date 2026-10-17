import { requireAdmin } from "@/lib/auth";
import StudioEditor from "@/components/studio-editor";
export const dynamic = "force-dynamic";
export const metadata = {title:"寫新筆記",robots:{index:false,follow:false}};
export default async function NewPost() {await requireAdmin();return <StudioEditor/>;}
