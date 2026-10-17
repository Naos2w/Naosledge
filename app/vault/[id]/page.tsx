import Link from "next/link";
import {notFound} from "next/navigation";
import VaultEditor from "@/components/vault-editor";
import {requireVault,privateVaultNote,listVaultTitles,vaultRelations} from "@/lib/vault-server";
import {wikiTargetMap} from "@/lib/wiki-links";
import {isKnowledgeId} from "@/lib/vault-validation";
import {privateVaultPreviewIntent} from "@/lib/neon/vault-preview";

export const dynamic="force-dynamic";
export const metadata={title:"編輯私人知識",robots:{index:false,follow:false}};

export default async function PrivateNote({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  if(!isKnowledgeId(id)) notFound();
  const context=await requireVault();
  const note=await privateVaultNote(context,id);
  if(!note) notFound();
  const titles=await listVaultTitles(context);
  const relations=await vaultRelations(context,note,titles);
  return <VaultEditor initial={note} targets={titles}
    wikiTargets={wikiTargetMap(titles)} relations={relations}
    allowPublication={!privateVaultPreviewIntent(process.env)}/>;
}
