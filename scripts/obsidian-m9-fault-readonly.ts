/**
 * Manual MSI read-only fault-latch inspection. Does NOT clear a marker,
 * access a private note, authenticate or authorise automatic resumption.
 */
import {hostname} from "node:os";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {inspectM9FaultReadOnly}
  from "../lib/obsidian-m9-fault-review-readonly.ts";

export const M9_FAULT_FLAG="--m9-fault-review-readonly";
export function assertM9FaultReadOnlyInvocation(args:{
  platform:string;host:string;flags:readonly string[];
}):void{
  if(args.platform!=="win32"||
     args.host.trim().toUpperCase()!=="MSI"||
     args.flags.length!==1||args.flags[0]!==M9_FAULT_FLAG){
    throw Error("M9 fault inspection requires MSI and its exact read-only flag");
  }
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===
  fileURLToPath(import.meta.url);
if(invoked){
  try{
    assertM9FaultReadOnlyInvocation({
      platform:process.platform,host:hostname(),flags:process.argv.slice(2),
    });
    const status=await inspectM9FaultReadOnly();
    console.log("M9_FAULT_REVIEW_READONLY "+JSON.stringify(status));
    console.log("NO_AUTO_RESTART; NO_LATCH_CLEAR; NO_VAULT_OR_PRODUCTION_WRITE");
  }catch{
    console.error("M9_FAULT_REVIEW_UNAVAILABLE; NO_AUTO_RESTART");
    process.exitCode=1;
  }
}
