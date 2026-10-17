import Link from "next/link";
import VaultEditor from "@/components/vault-editor";
import {requireVault,listVaultTitles} from "@/lib/vault-server";
import {wikiTargetMap} from "@/lib/wiki-links";
import {privateVaultPreviewIntent} from "@/lib/neon/vault-preview";

export const dynamic="force-dynamic";
export const metadata={title:"新增私人知識",robots:{index:false,follow:false}};

export default async function NewPrivateNote() {
  const context=await requireVault();
  let titles:Awaited<ReturnType<typeof listVaultTitles>>=[];
  try {titles=await listVaultTitles(context);} catch {
    return <section className="vault-root container"><h1>私人資料庫尚未就緒</h1>
      <p>需要先在明確核准的環境套用 Private Vault Migration。</p>
      <Link href="/vault" className="text-link">返回私人索引</Link></section>;
  }
  return <VaultEditor targets={titles} wikiTargets={wikiTargetMap(titles)}
    allowPublication={!privateVaultPreviewIntent(process.env)}/>;
}
