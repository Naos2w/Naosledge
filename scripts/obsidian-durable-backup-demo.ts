/**
 * Non-production manual demo of fsynced synthetic backup + per-note consent.
 * No path inputs, no real Obsidian Vault, no Neon calls, no scheduler.
 * All scratch files are removed explicitly in finally.
 */
import {createHash} from "node:crypto";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";

const flags=process.argv.slice(2);
const downloadFlag="--approve-download=shared-note";
const restoreFlag="--approve-restore=shared-note";
if(flags.length>2||flags.some(x=>x!==downloadFlag&&x!==restoreFlag)||
   new Set(flags).size!==flags.length||
   (flags.includes(restoreFlag)&&!flags.includes(downloadFlag))){
  console.error("Only explicit synthetic --approve-download=shared-note and optional --approve-restore=shared-note are supported");
  process.exitCode=2;
}else{
  const box=await createDurableSyntheticObsidianWorkspace();
  try{
    const before="# Synthetic before download";
    const incoming="# Synthetic updated from fake remote";
    await box.setBaseline([{
      slug:"shared-note",sha256:createHash("sha256").update(before).digest("hex"),
    }]);
    await box.seedLocal("shared-note",before);
    await box.seedRemote("shared-note",incoming);
    const preview=await box.preview();
    console.log("SYNTHETIC_DURABLE_PREVIEW "+JSON.stringify({
      choices:preview.plan.decisions.map(d=>({slug:d.slug,choice:d.choice})),
      autoApplyAllowed:preview.plan.autoApplyAllowed,
      realVaultTouched:false,neonTouched:false,
    }));
    if(flags.includes(downloadFlag)){
      const consent=preview.consents.find(x=>x.slug==="shared-note");
      if(!consent)throw Error("No eligible reviewed synthetic download");
      const result=await box.approvedDownload({
        slug:"shared-note",confirmation:consent.confirmation,
      });
      console.log("SYNTHETIC_DURABLE_DOWNLOAD "+JSON.stringify({
        slug:result.slug,backupWritten:!!result.backupId,
        backups:(await box.listDurableBackups()).length,
        automaticSyncEnabled:result.automaticSyncEnabled,
      }));
      if(flags.includes(restoreFlag)){
        const restoration=await box.prepareRestore(result.backupId!);
        const restored=await box.approvedRestore({
          id:result.backupId!,confirmation:restoration.confirmation,
        });
        console.log("SYNTHETIC_DURABLE_RESTORE "+JSON.stringify({
          restored:true,undoBackupWritten:!!restored.backupId,
          backups:(await box.listDurableBackups()).length,
          restoredPreviousContents:(await box.readLocalForSyntheticTest("shared-note"))===before,
        }));
      }
    }
    console.log("SYNTHETIC_DURABLE_DEMO_SUCCESS "+JSON.stringify({
      status:"synthetic scratch only",
      realObsidianFilesChanged:false,
      neonProdWrites:0,
      backgroundSyncEnabled:false,
    }));
  }catch(error){
    const why=error instanceof Error?error.message:String(error);
    console.error("SYNTHETIC_DURABLE_DEMO_FAILURE "+why.slice(0,160));
    process.exitCode=1;
  }finally{
    await box.destroyScratch();
  }
}
