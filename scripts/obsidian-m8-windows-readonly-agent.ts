/**
 * Explicit MSI foreground read-only Agent. NOT a Windows service, task,
 * autostart or sync executor. A short-lived Owner JWT is supplied only via
 * private piped stdin, kept only in process memory, and never echoed.
 *
 * This entrypoint can safely run a local watcher plus real Production
 * Owner-RLS metadata checks, then exits when the session expires or receives
 * SIGINT / SIGTERM. It does NOT implement background token refresh.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertApprovedMsiHost} from "./obsidian-msi-vault-readonly.ts";
import {readM7ProductionOwnerJwt}
  from "./obsidian-m7-production-preflight.ts";
import {validateProductionOwnerJwt}
  from "../lib/obsidian-m7-production-owner-readonly.ts";
import {createM8WindowsReadOnlyAgent}
  from "../lib/obsidian-m8-windows-agent-controller.ts";

const FLAG="--m8-readonly-foreground-agent";
const STOP_MARGIN=120;
const MAX_SESSION_SECONDS=60*60;
export function assertM8WindowsReadOnlyAgentInvocation(input:{
  platform:string;hostname:string;flags:readonly string[];stdinIsTTY:boolean;
}){
  assertApprovedMsiHost(input.platform,input.hostname);
  if(input.flags.length!==1||input.flags[0]!==FLAG||input.stdinIsTTY){
    throw Error("M8 read-only Agent requires MSI, exact flag and piped JWT");
  }
}
export function m8OwnerSessionRuntimeSeconds(
  jwt:string,now=Math.floor(Date.now()/1000),
):number{
  validateProductionOwnerJwt(jwt,now+STOP_MARGIN);
  let payload:unknown;
  try{payload=JSON.parse(Buffer.from(jwt.split(".")[1],"base64url").toString("utf8"));}
  catch{throw Error("M8 Owner session lifetime unavailable");}
  const exp=(payload as {exp?:unknown})?.exp;
  if(typeof exp!=="number"||!Number.isSafeInteger(exp)||
     exp<=now+STOP_MARGIN)throw Error("M8 Owner session lifetime unavailable");
  return Math.min(MAX_SESSION_SECONDS,exp-now-STOP_MARGIN);
}
type ForegroundAgent=ReturnType<typeof createM8WindowsReadOnlyAgent>;
/** Test injections are only supplied directly by isolated unit tests. */
export async function runM8ReadOnlyForegroundSession(args:{
  jwt:string;
  signal:AbortSignal;
  createAgent?:(jwtProvider:()=>Promise<string>)=>ForegroundAgent;
  onSnapshot?:(info:{mode:string;localNotes:number;remoteNotes:number;
    manualReviews:number;automaticTransfersEnabled:false})=>void;
}):Promise<{
  started:boolean;
  stopped:true;
  automaticTransfersEnabled:false;
  tokensStoredOnDisk:0;
}>{
  const lifetime=m8OwnerSessionRuntimeSeconds(args.jwt);
  if(!args.signal||typeof args.signal.aborted!=="boolean")throw Error("M8 abort signal required");
  if(args.signal.aborted)throw Error("M8 foreground Agent already stopped");
  // One finite-life token for this foreground session. The agent's own
  // acquire() enforces expiry+Owner checks before EVERY scan. Once expired,
  // this invocation stops rather than trying to steal browser Cookies.
  const provider=async()=>args.jwt;
  const agent=(args.createAgent??(getOwnerJwt=>createM8WindowsReadOnlyAgent({
    requestFreshJwt:getOwnerJwt,
    onStatus:summary=>args.onSnapshot?.({
      mode:summary.mode,localNotes:summary.localNotes,
      remoteNotes:summary.remoteNotes,
      manualReviews:summary.manualReviews,
      automaticTransfersEnabled:false,
    }),
  })))(provider);
  let started=false,stopTimer:ReturnType<typeof setTimeout>|null=null;
  try{
    await agent.start();
    started=true;
    await new Promise<void>(resolve=>{
      if(args.signal.aborted){resolve();return;}
      const onAbort=()=>resolve();
      args.signal.addEventListener("abort",onAbort,{once:true});
      stopTimer=setTimeout(()=>{
        args.signal.removeEventListener("abort",onAbort);
        resolve();
      },lifetime*1000);
    });
  }finally{
    if(stopTimer!==null)clearTimeout(stopTimer);
    // A lock cleanup failure must NOT be reported as a clean shutdown.
    await agent.stop();
  }
  return {
    started,stopped:true,automaticTransfersEnabled:false,
    tokensStoredOnDisk:0,
  };
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===
  fileURLToPath(import.meta.url);
if(invoked){
  const controller=new AbortController();
  const exit=()=>controller.abort();
  process.on("SIGINT",exit);
  process.on("SIGTERM",exit);
  try{
    assertM8WindowsReadOnlyAgentInvocation({
      platform:process.platform,hostname:hostname(),
      flags:process.argv.slice(2),stdinIsTTY:!!process.stdin.isTTY,
    });
    const jwt=await readM7ProductionOwnerJwt(process.stdin);
    console.log("M8_READONLY_AGENT_STARTING; NO_TRANSFER");
    const result=await runM8ReadOnlyForegroundSession({
      jwt,signal:controller.signal,
      onSnapshot:info=>console.log("M8_AGENT_READONLY_STATUS "+
        JSON.stringify(info)),
    });
    console.log("M8_READONLY_AGENT_STOPPED "+JSON.stringify(result));
  }catch{
    // Never reveal login details, Owner ID, JWT, note filenames or raw errors.
    console.error("M8_READONLY_AGENT_UNAVAILABLE; NO_TRANSFER");
    process.exitCode=1;
  }finally{
    process.off("SIGINT",exit);
    process.off("SIGTERM",exit);
  }
}
