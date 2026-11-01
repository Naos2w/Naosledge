/**
 * MSI-only, explicitly started M9 foreground automatic Agent.
 *
 * Starts only after the user submits an exact confirmation and a Production
 * catalog-only PostgreSQL connection via private STDIN. Requires the existing
 * independent DPAPI Owner session and signed M5 opt-in. Controls remain on the
 * same private STDIN pipe: status / pause / resume / stop.
 *
 * No service, task, autostart, browser-cookie reuse, automatic fault unlock,
 * Neon migrations or deployment. Fail closed on EOF, signal or errors.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createInterface} from "node:readline";
import {createM9WindowsAutoAgent}
  from "../lib/obsidian-m9-windows-auto-agent.ts";
import {createM9IndependentProductionOwnerSession}
  from "../lib/obsidian-m9-independent-owner-session.ts";
import {
  assertM9SchemaReaderConnection,
  createM9ProductionSql003ReadinessProvider,
} from "../lib/obsidian-m9-production-schema-readiness.ts";

const FLAG="--m9-owner-foreground-auto-agent";
const CONFIRM="START M9 OWNER FOREGROUND AGENT";
export type M9ForegroundStart={
  readOnlySchemaConnectionString:string;
  typedConfirmation:typeof CONFIRM;
};

export function assertM9ForegroundInvocation(input:{
  platform:string;host:string;flags:readonly string[];stdinIsTty:boolean;
}):void{
  if(!input||input.platform!=="win32"||
     input.host.trim().toUpperCase()!=="MSI"||
     input.flags.length!==1||input.flags[0]!==FLAG||
     input.stdinIsTty){
    throw Error("M9 foreground Agent requires exact MSI invocation and pipe");
  }
}

export function parseM9ForegroundStart(line:string):M9ForegroundStart{
  if(typeof line!=="string"||Buffer.byteLength(line,"utf8")>4096){
    throw Error("M9 foreground private input unavailable");
  }
  let value:unknown;
  try{value=JSON.parse(line);}catch{
    throw Error("M9 foreground private input unavailable");
  }
  if(!value||typeof value!=="object"||Array.isArray(value)){
    throw Error("M9 foreground private input unavailable");
  }
  const v=value as Record<string,unknown>;
  if(JSON.stringify(Object.keys(v).sort())!==JSON.stringify([
    "readOnlySchemaConnectionString","typedConfirmation"].sort())||
     typeof v.readOnlySchemaConnectionString!=="string"||
     v.typedConfirmation!==CONFIRM){
    throw Error("M9 foreground private input unavailable");
  }
  assertM9SchemaReaderConnection(v.readOnlySchemaConnectionString);
  return v as M9ForegroundStart;
}

type Agent=ReturnType<typeof createM9WindowsAutoAgent>;
export function safeM9AgentStatus(status:ReturnType<Agent["status"]>){
  return {
    state:status.state,scans:status.scans,faults:status.faults,
    lastStatus:status.last?.status??null,
    manualReviewCount:status.last?.manualReviewCount??0,
    transferCount:status.last?.transferCount??0,
    automaticDeletionAllowed:false as const,
  };
}

/** Actual commands, not an inert UI. "stop" is handled by the caller's
 * finally block so that a pending transfer drains before process exit. */
export async function controlM9ForegroundAgent(agent:Agent,command:string){
  if(command==="status")return {command,status:safeM9AgentStatus(agent.status())};
  if(command==="pause"){agent.pause();return {command,status:safeM9AgentStatus(agent.status())};}
  if(command==="resume"){await agent.resume();return {command,status:safeM9AgentStatus(agent.status())};}
  if(command==="stop")return {command,stop:true as const};
  throw Error("M9 foreground control rejected");
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===
  fileURLToPath(import.meta.url);
if(invoked){
  const abort=new AbortController();
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity,
    terminal:false});
  const end=()=>{abort.abort();lines.close();};
  process.on("SIGINT",end);
  process.on("SIGTERM",end);
  let agent:Agent|null=null;
  try{
    assertM9ForegroundInvocation({
      platform:process.platform,host:hostname(),
      flags:process.argv.slice(2),stdinIsTty:!!process.stdin.isTTY,
    });
    const iterator=lines[Symbol.asyncIterator]();
    const first=await iterator.next();
    if(first.done||abort.signal.aborted)throw Error("No operator");
    const start=parseM9ForegroundStart(first.value);
    const owner=createM9IndependentProductionOwnerSession();
    const verifyProductionSchema=createM9ProductionSql003ReadinessProvider(
      start.readOnlySchemaConnectionString);
    // Do NOT initiate login or signed mode activation. The current MSI user
    // must have separately enrolled a valid Production Owner session.
    await owner.requestFreshJwt();
    if(abort.signal.aborted)throw Error("Stopped");
    agent=createM9WindowsAutoAgent({
      requestFreshJwt:()=>owner.requestFreshJwt(),
      verifyProductionSchema,
      onCycle:(info)=>console.log("M9_AGENT_CYCLE "+JSON.stringify({
        status:info.status,action:info.action,
        manualReviewCount:info.manualReviewCount,
        transferCount:info.transferCount,
      })),
      onFault:()=>{console.error("M9_AGENT_FAULT; MANUAL_REVIEW_REQUIRED");end();},
    });
    await agent.start();
    console.log("M9_AGENT_FOREGROUND_STARTED; CONTROL=status|pause|resume|stop");
    if(abort.signal.aborted)throw Error("Stopped");
    for await(const command of {[Symbol.asyncIterator]:()=>iterator}){
      if(abort.signal.aborted)break;
      const result=await controlM9ForegroundAgent(agent,command.trim());
      console.log("M9_AGENT_CONTROL "+JSON.stringify(result));
      if("stop" in result)break;
    }
  }catch{
    // Hide credentials, JWT, private note names, paths and underlying errors.
    console.error("M9_AGENT_UNAVAILABLE_OR_STOPPED; NO_AUTOMATIC_RESTART");
    process.exitCode=1;
  }finally{
    end();
    if(agent){
      try{await agent.stop();}
      catch{
        console.error("M9_AGENT_SHUTDOWN_UNCERTAIN; MANUAL_REVIEW_REQUIRED");
        process.exitCode=1;
      }
    }
    process.off("SIGINT",end);
    process.off("SIGTERM",end);
    console.log("M9_AGENT_FOREGROUND_EXITED; NO_SERVICE_INSTALLED");
  }
}
