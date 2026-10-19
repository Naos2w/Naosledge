/**
 * Manual, cost-free Obsidian two-way sync rehearsal. SYNTHETIC ONLY.
 *
 * Examples:
 *   node scripts/obsidian-sync-sandbox-demo.ts
 *   node scripts/obsidian-sync-sandbox-demo.ts --approve-upload=local-edited
 *   node scripts/obsidian-sync-sandbox-demo.ts --approve-download=remote-edited
 *
 * Every flag is a separate operator-initiated decision. No unattended
 * schedule, production Vault access, Neon Auth or external HTTP traffic.
 */
import {createHash} from "node:crypto";
import {createObsidianSandbox} from "../lib/obsidian-sync-sandbox.ts";

const approvedOptions=new Map<string,{slug:string;direction:"upload"|"download"}>([
  ["--approve-upload=local-edited",{slug:"local-edited",direction:"upload"}],
  ["--approve-download=remote-edited",{slug:"remote-edited",direction:"download"}],
]);
const requested=process.argv.slice(2);
if(requested.some(x=>!approvedOptions.has(x))||new Set(requested).size!==requested.length){
  console.error("INVALID_SANDBOX_FLAGS: only the two explicit synthetic note approvals are allowed");
  process.exitCode=2;
}else{
  const sandbox=await createObsidianSandbox();
  try{
    const base="# Synthetic v1";
    const hash=createHash("sha256").update(base).digest("hex");
    sandbox.setBaseline(["local-edited","remote-edited","both-conflicted"].map(
      slug=>({slug,sha256:hash})
    ));
    await sandbox.seedLocal("local-edited","# Synthetic local changed");
    sandbox.seedSyntheticRemote("local-edited",base);
    await sandbox.seedLocal("remote-edited",base);
    sandbox.seedSyntheticRemote("remote-edited","# Synthetic remote changed");
    await sandbox.seedLocal("both-conflicted","# Synthetic local divergent");
    sandbox.seedSyntheticRemote("both-conflicted","# Synthetic remote divergent");

    const before=await sandbox.preview();
    console.log("SANDBOX_PREVIEW "+JSON.stringify({
      decisions:before.decisions.map(x=>({slug:x.slug,choice:x.choice})),
      autoApplyAllowed:before.autoApplyAllowed,
      isolatedScratchOnly:true,
    }));
    for(const option of requested){
      const item=approvedOptions.get(option)!;
      // Preview must be regenerated for EVERY manually approved action.
      await sandbox.preview();
      const receipt=await sandbox.apply({
        ...item,confirmation:"APPROVE "+item.direction.toUpperCase()+" "+item.slug,
      });
      console.log("SANDBOX_APPROVED_TRANSFER "+JSON.stringify({
        slug:receipt.slug,direction:receipt.direction,
        backedUpExistingLocal:receipt.backedUpExistingLocal,
        sandboxOnly:true,
      }));
    }
    const after=await sandbox.preview();
    if(after.summary.conflict!==1){
      throw new Error("Safety failure: divergent synthetic note was unexpectedly changed");
    }
    console.log("SANDBOX_RESULT "+JSON.stringify({
      remaining:after.summary,
      localTempBackups:await sandbox.localBackupCountForTest(),
      realVaultTouched:false,neonTouched:false,
      automaticSyncEnabled:false,
    }));
  }catch(error){
    const cause=error instanceof Error?error.message:String(error);
    console.error("SANDBOX_FAILED "+cause.slice(0,160));
    process.exitCode=1;
  }finally{
    await sandbox.close();
  }
}
