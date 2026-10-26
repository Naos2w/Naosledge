/**
 * Manual, read-only cross-process M5 rehearsal. Input is a complete SYNTHETIC
 * remote fingerprint snapshot (not a JWT, Markdown or real Neon API session).
 *
 * node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/obsidian-m5-scratch-recovery.ts --synthetic-readonly <OS-temp-scratch-path> < remote-fingerprints.json
 */
import {inspectSyntheticCrossProcessRecovery} from "../lib/obsidian-m5-scratch-recovery.ts";

async function main(){
  if(process.argv.length!==4||process.argv[2]!=="--synthetic-readonly"){
    throw Error("Expected --synthetic-readonly <OS-temp-scratch-path>");
  }
  let text="";
  for await(const chunk of process.stdin){
    text+=String(chunk);
    if(Buffer.byteLength(text)>100_000)throw Error("Remote fingerprint snapshot is oversized");
  }
  const snapshot=JSON.parse(text) as Parameters<typeof inspectSyntheticCrossProcessRecovery>[0]["remoteSnapshot"];
  const report=await inspectSyntheticCrossProcessRecovery({
    scratchPath:process.argv[3],remoteSnapshot:snapshot,
  });
  process.stdout.write(JSON.stringify(report)+"\n");
}
main().catch(()=>{
  // Never echo stdin; it must not become an accidental JWT/Markdown log.
  process.stderr.write("M5 synthetic recovery inspection refused; no changes applied\n");
  process.exitCode=1;
});
