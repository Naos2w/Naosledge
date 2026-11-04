/**
 * Explicit MSI-only manual M9 fault triage.
 * Uses the independent Owner session without exporting its short-lived JWT.
 * Hashes and compares current sources locally; prints ONLY coarse status.
 * No marker clearing, sync, note/body export, scheduled service or restart.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createM9IndependentProductionOwnerSession}
  from "../lib/obsidian-m9-independent-owner-session.ts";
import {inspectM9FaultReconciliationReadOnly}
  from "../lib/obsidian-m9-fault-reconciliation-readonly.ts";

export const M9_RECONCILE_FLAG="--m9-fault-reconcile-readonly";
export function assertM9FaultReconcileInvocation(args:{
  platform:string;host:string;flags:readonly string[];
}):void{
  if(args.platform!=="win32"||
     args.host.trim().toUpperCase()!=="MSI"||
     args.flags.length!==1||args.flags[0]!==M9_RECONCILE_FLAG){
    throw Error("M9 reconciliation requires MSI and exact read-only flag");
  }
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===
  fileURLToPath(import.meta.url);
if(invoked){
  try{
    assertM9FaultReconcileInvocation({
      platform:process.platform,host:hostname(),flags:process.argv.slice(2),
    });
    const session=createM9IndependentProductionOwnerSession();
    const jwt=await session.requestFreshJwt();
    const result=await inspectM9FaultReconciliationReadOnly({ownerJwt:jwt});
    console.log("M9_RECONCILE_READONLY "+JSON.stringify(result));
    console.log("MANUAL_REVIEW_ONLY; NO_LATCH_CLEAR; NO_RESTART; NO_NOTE_WRITES");
  }catch{
    console.error("M9_RECONCILE_UNAVAILABLE; NO_RESTART");
    process.exitCode=1;
  }
}
