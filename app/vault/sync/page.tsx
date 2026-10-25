import "@/app/vault/vault-sync.css";
import VaultManualSyncReview from "@/components/vault-manual-sync-review";
import {requireVault} from "@/lib/vault-server";

export const dynamic="force-dynamic";
export const metadata={
  title:"手動同步唯讀審查 | NaosLedge",
  robots:{index:false,follow:false},
};

/**
 * Owner-only M2 read-only review. Starts empty and requires an explicit MSI
 * Sandbox snapshot import; no synthetic notes or network sync are loaded.
 */
export default async function VaultManualReviewPage(){
  await requireVault();
  return <VaultManualSyncReview/>;
}
