/**
 * Explicit, MSI-only independent managed Neon Auth session CLI.
 *
 * --enroll accepts a single bounded JSON object over PRIVATE STDIN, never
 * credentials on argv or env. --health revalidates the existing DPAPI-sealed
 * session against Production Owner RLS and refreshes its short-lived JWT.
 * This CLI does NOT enable, start, or install automatic synchronization.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createM9IndependentProductionOwnerSession}
  from "../lib/obsidian-m9-independent-owner-session.ts";

const ENROLL="--m9-independent-owner-enroll";
const HEALTH="--m9-independent-owner-health";
export function validateM9SessionCli(args:{
  platform:string;hostname:string;flags:readonly string[];
  stdinIsTty:boolean;
}):"enroll"|"health"{
  if(!args||args.platform!=="win32"||
     args.hostname.trim().toUpperCase()!=="MSI"||
     args.flags.length!==1||
     ![ENROLL,HEALTH].includes(args.flags[0]))throw Error("M9 session CLI is MSI-only");
  if(args.flags[0]===ENROLL&&args.stdinIsTty)throw Error("M9 private stdin required");
  return args.flags[0]===ENROLL?"enroll":"health";
}
export async function parseM9PrivateEnrollment(
  stream:NodeJS.ReadableStream,
):Promise<{email:string;password:string;typedConfirmation:string}>{
  let bytes=0,content="";
  for await(const data of stream){
    const piece=Buffer.isBuffer(data)?data:Buffer.from(data as string);
    bytes+=piece.length;
    if(bytes>4_096)throw Error("M9 private enrollment input too large");
    content+=piece.toString("utf8");
  }
  let parsed:unknown;
  try{parsed=JSON.parse(content);}catch{
    throw Error("M9 private enrollment input invalid");
  }
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
    throw Error("M9 private enrollment input invalid");
  }
  const val=parsed as Record<string,unknown>;
  if(JSON.stringify(Object.keys(val).sort())!==JSON.stringify([
    "email","password","typedConfirmation"].sort())||
     typeof val.email!=="string"||typeof val.password!=="string"||
     val.typedConfirmation!=="ENROLL M9 INDEPENDENT PRODUCTION SESSION"){
    throw Error("M9 private enrollment input invalid");
  }
  return val as {email:string;password:string;typedConfirmation:string};
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===
  fileURLToPath(import.meta.url);
if(invoked){
  try{
    const operation=validateM9SessionCli({
      platform:process.platform,hostname:hostname(),
      flags:process.argv.slice(2),stdinIsTty:!!process.stdin.isTTY,
    });
    const broker=createM9IndependentProductionOwnerSession();
    if(operation==="enroll"){
      const payload=await parseM9PrivateEnrollment(process.stdin);
      const result=await broker.enrollEmail(payload);
      if(!result.enrolled||!result.ownerRlsVerified)throw Error();
      console.log("M9_INDEPENDENT_OWNER_SESSION_ENROLLED; NO_AUTOMATIC_SYNC");
    }else{
      await broker.requestFreshJwt();
      console.log("M9_INDEPENDENT_OWNER_SESSION_HEALTH_OK; NO_AUTOMATIC_SYNC");
    }
  }catch{
    // Never log passwords, cookies, JWTs, email, endpoint failures or names.
    console.error("M9_INDEPENDENT_OWNER_SESSION_UNAVAILABLE; NO_AUTOMATIC_SYNC");
    process.exitCode=1;
  }
}
