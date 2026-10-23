import "@/app/vault/vault-sync.css";
import VaultManualSyncReview from "@/components/vault-manual-sync-review";
import {makeSyntheticM2Preview} from "@/lib/obsidian-m2-synthetic-fixture";
import {requireVault} from "@/lib/vault-server";

export const dynamic="force-dynamic";
export const metadata={
  title:"手動同步審查預演 | NaosLedge",
  robots:{index:false,follow:false},
};

/**
 * Owner-only M2 interaction DEMO. No sync API or native MSI adapter is invoked.
 * Never accidentally infer M1 is live because this example route renders.
 */
export default async function VaultManualReviewPage(){
  await requireVault();
  const preview=await makeSyntheticM2Preview();
  return <VaultManualSyncReview preview={preview}/>;
}
