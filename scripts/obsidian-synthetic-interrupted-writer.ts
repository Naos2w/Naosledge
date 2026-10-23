/**
 * Offline interruption fixture ONLY. Intentionally leaves generated TEMP
 * synthetic files behind when the process exits with a non-zero code.
 * A separate test driver must clean up the exact generated scratch folder.
 * Never accepts user-provided paths and never loads actual Obsidian notes.
 */
import {createHash,randomUUID} from "node:crypto";
import {open} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {createDurableSyntheticObsidianWorkspace} from "../lib/obsidian-durable-write-sandbox.ts";

function sha(body:string){return createHash("sha256").update(body).digest("hex");}

async function main(){
  if(process.argv.length!==2)throw Error("Synthetic interruption fixture takes no paths");
  const box=await createDurableSyntheticObsidianWorkspace();
  let deliberateInterruption=false;
  try{
    const folder=box.syntheticWorkspacePath;
    const id=path.basename(folder);
    if(path.dirname(folder).toLowerCase()!==path.resolve(tmpdir()).toLowerCase()||
       !/^naosledge-durable-synthetic-only-[A-Za-z0-9_-]{6,32}$/.test(id)){
      throw Error("Synthetic interruption fixture is not under system TEMP");
    }
    await box.setBaseline([{slug:"restart-note",sha256:sha("synthetic-old")}]);
    await box.seedLocal("restart-note","synthetic-old");
    await box.seedRemote("restart-note","synthetic-new");
    const approval=(await box.preview()).consents.find(c=>c.slug==="restart-note");
    if(!approval)throw Error("Synthetic restart preview missing approval");
    await box.approvedDownload({
      slug:"restart-note",confirmation:approval.confirmation,
    });

    // Simulate the point where .bak was fsynced but .json was never created.
    const orphan=path.join(folder,"backups",randomUUID()+".bak");
    const h=await open(orphan,"wx",0o600);
    try{
      await h.writeFile("synthetic-incomplete-backup");
      await h.sync();
    }finally{await h.close();}

    // Simulate an abandoned cooperative lock after a terminated process.
    const l=await open(path.join(folder,"locks","backup-catalog.lock"),"wx",0o600);
    try{
      await l.writeFile("synthetic-abandoned-lock");
      await l.sync();
    }finally{await l.close();}

    deliberateInterruption=true;
    console.log("NAOSLEDGE_SYNTHETIC_INTERRUPTED_WRITER "+id);
    // Deliberate process termination discards in-memory baselines and grants.
    // There is no cleanup here by design. The parent test cleans the fixture.
    process.exit(47);
  }finally{
    if(!deliberateInterruption)await box.destroyScratch();
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{
    console.error("SYNTHETIC_INTERRUPTED_WRITER_FAILED");
    process.exitCode=2;
  });
}
