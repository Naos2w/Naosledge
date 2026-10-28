/**
 * Explicit MSI-only M7 Production OWNER-RLS + registered Vault read-only
 * preflight. Accept only a short-lived Production JWT via private stdin.
 * This is NOT a Production upload/download, login automation or M2 inventory.
 */
import {homedir,hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {assertApprovedMsiHost} from "./obsidian-msi-vault-readonly.ts";
import {inspectObsidianRegistration} from "../lib/obsidian-vault-registration.ts";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {verifyM7ProductionOwnerReadOnly}
  from "../lib/obsidian-m7-production-owner-readonly.ts";

const FIXED_VAULT="C:\\Naos\\Obsidian\\Naosledge";
const FLAG="--m7-production-owner-readonly";
export function assertM7ReadOnlyInvocation(
  platform:string,computerName:string,args:readonly string[],isTerminal:boolean,
):void{
  assertApprovedMsiHost(platform,computerName);
  if(args.length!==1||args[0]!==FLAG||isTerminal){
    throw Error("M7 requires one exact manual read-only flag and piped JWT");
  }
}
export async function readM7ProductionOwnerJwt(
  input:AsyncIterable<string|Uint8Array>,
):Promise<string>{
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of input){
    const part=typeof chunk==="string"?Buffer.from(chunk,"utf8"):Buffer.from(chunk);
    bytes+=part.length;
    if(bytes>8192)throw Error("M7 Production JWT stdin input too large");
    chunks.push(part);
  }
  const jwt=Buffer.concat(chunks).toString("utf8").trim();
  if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)){
    throw Error("M7 Production JWT stdin malformed");
  }
  return jwt;
}
export async function previewM7ProductionOwnerReadiness(args:{
  productionOwnerJwt:string;
  vaultPath?:string;
  registryPath?:string;
  remoteReader?:typeof verifyM7ProductionOwnerReadOnly;
  registrationReader?:typeof inspectObsidianRegistration;
  localReader?:typeof readObsidianLocalManifest;
}){
  const remote=await (args.remoteReader??verifyM7ProductionOwnerReadOnly)({
    productionOwnerJwt:args.productionOwnerJwt,
  });
  if(remote.productionBranchVerified!==true||remote.ownerRlsGrantVerified!==true||
     remote.writeEnabled!==false||remote.privateNoteBodiesRead!==false||
     remote.remoteFullInventoryRead!==false){
    throw Error("M7 Production RLS reader returned unsafe state");
  }
  const vaultPath=args.vaultPath??FIXED_VAULT;
  const registryPath=args.registryPath??path.join(process.env.APPDATA||
    path.join(homedir(),"AppData","Roaming"),"obsidian","obsidian.json");
  const registration=await (args.registrationReader??inspectObsidianRegistration)({
    vaultPath,registryPath,
  });
  if(registration.registered!==true||registration.autoSyncEnabled!==false){
    throw Error("M7 real Obsidian Vault is not registered for manual inspection");
  }
  const manifest=await (args.localReader??readObsidianLocalManifest)(vaultPath);
  if(manifest.autoApplyAllowed!==false)throw Error("M7 local reader unsafe");
  return {
    mode:"M7_PRODUCTION_OWNER_READONLY_PREFLIGHT",
    ownerRlsGrantVerified:true,
    productionBranchVerified:true,
    productionRemoteNotes:remote.remoteNoteCount,
    localSupportedNotes:manifest.fingerprints.length,
    localUnsupportedMarkdown:manifest.unsupportedMarkdownFiles,
    localDirectoriesNotScanned:manifest.directoriesNotScanned,
    remoteFullInventoryRead:false,
    comparisonPerformed:false,
    noteBodiesTransferred:false,
    baselineSaved:false,
    localWrites:0,
    remoteWrites:0,
    automaticSyncEnabled:false,
    perNoteApprovalGranted:false,
  } as const;
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    assertM7ReadOnlyInvocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const jwt=await readM7ProductionOwnerJwt(process.stdin);
    const result=await previewM7ProductionOwnerReadiness({productionOwnerJwt:jwt});
    console.log("M7_PRODUCTION_OWNER_READONLY "+JSON.stringify(result));
    console.log("NO_TRANSFER; NO_BASELINE; NO_AUTO_SYNC; NO_PRODUCTION_WRITE");
  }catch{
    // Deliberately do NOT print error details or sensitive input.
    console.error("M7_PRODUCTION_OWNER_READONLY_NOT_VERIFIED; NO_TRANSFER");
    process.exitCode=1;
  }
}
