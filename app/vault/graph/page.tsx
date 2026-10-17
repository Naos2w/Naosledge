import Link from "next/link";
import VaultKnowledgeGraph from "@/components/vault-knowledge-graph";
import {loadVaultGraph,requireVault} from "@/lib/vault-server";
import {isKnowledgeId} from "@/lib/vault-validation";

export const dynamic="force-dynamic";
export const metadata={
  title:"私人知識網絡 | Naosledge",
  robots:{index:false,follow:false},
};

export default async function PrivateKnowledgeGraphPage({searchParams}:{
  searchParams:Promise<{focus?:string|string[]}>;
}){
  const context=await requireVault();
  const {focus}=await searchParams;
  const initialFocusId=typeof focus==="string"&&isKnowledgeId(focus)?focus:null;
  try{
    const snapshot=await loadVaultGraph(context);
    return <VaultKnowledgeGraph {...snapshot} initialFocusId={initialFocusId}/>;
  }catch{
    // Never interpolate private query errors into public HTML or logs.
    return <section className="vault-root container">
      <span className="section-kicker">SECOND BRAIN / PRIVATE</span>
      <h1>私人知識網絡暫時無法讀取。</h1>
      <p>請稍後重試，或返回私人知識庫。現有筆記不會受到影響。</p>
      <Link href="/vault" className="text-link">返回私人筆記索引</Link>
    </section>;
  }
}
