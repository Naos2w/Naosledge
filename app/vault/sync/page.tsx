import "@/app/vault/vault-sync.css";
import VaultManualSyncReview from "@/components/vault-manual-sync-review";
import {requireVault} from "@/lib/vault-server";
import {observeM7ProductionOwnerWebReadiness}
  from "@/lib/obsidian-m7-web-owner-readiness";

export const dynamic="force-dynamic";
export const metadata={
  title:"手動同步唯讀審查 | NaosLedge",
  robots:{index:false,follow:false},
};

/**
 * The existing requireVault() verifies the real signed-in Neon Auth session
 * and the Owner's blog_admins membership through the member JWT / RLS.
 * Production M7 only counts notes using this same verified client. The M2
 * Sandbox-only import remains separate, read-only and non-executable.
 */
export default async function VaultManualReviewPage(){
  const context=await requireVault();
  const m7ProductionReadiness=await observeM7ProductionOwnerWebReadiness({
    environment:process.env,
    ownerRlsCount:async()=>{
      const {data,count,error}=await context.supabase.from("knowledge_notes")
        .select("id",{count:"exact"})
        .eq("owner_id",context.user.id)
        .limit(1);
      return {data,count,error};
    },
  });
  return <VaultManualSyncReview m7ProductionReadiness={m7ProductionReadiness}/>;
}
