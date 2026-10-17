import { notFound } from "next/navigation";
import StudioEditor from "@/components/studio-editor";
import { requireAdmin } from "@/lib/auth";
import type { Post } from "@/lib/types";
export const metadata = {title:"編輯筆記",robots:{index:false,follow:false}};
export default async function EditPost({params}:{params:Promise<{id:string}>}) {
  const {supabase,user}=await requireAdmin();
  const {id}=await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const {data,error}=await supabase.from("posts").select("*").eq("id",id).eq("author_id",user.id).maybeSingle();
  if (error || !data) notFound();
  return <StudioEditor initial={data as Post}/>;
}
