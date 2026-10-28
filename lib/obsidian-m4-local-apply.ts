/**
 * M4 local-side commit. Runs only AFTER a separately verified M2 download
 * decision, existing M4 Incoming receipt and fresh Neon Owner-RLS GET.
 *
 * The live caller pins the already registered MSI Vault. Dependency-supplied
 * roots are allowed only in random OS-temp test workspaces. No network or
 * Baseline write here; the M5 coordinator owns those operations.
 *
 * Existing originals are independently backed up to the private M5 journal
 * area and fsynced before an atomic rename. For a missing note, wx ensures
 * that a concurrent newly created note is never overwritten. Uncertain
 * failures preserve backups; nothing rolls a changed document back silently.
 */
import {createHash,randomUUID} from "node:crypto";
import {homedir,hostname} from "node:os";
import {lstat,mkdir,open,readFile,realpath,rename,unlink} from "node:fs/promises";
import path from "node:path";
import {inspectObsidianRegistration} from "./obsidian-vault-registration.ts";
import {parseObsidianMarkdown,serializeObsidianMarkdown} from "./obsidian-markdown.ts";

export const APPROVED_MSI_VAULT="C:\\Naos\\Obsidian\\Naosledge";
const SHA=/^[a-f0-9]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX=250_000;
const digest=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");

async function safeFolder(directory:string):Promise<void>{
  const stat=await lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     path.normalize(await realpath(directory)).toLowerCase()!==
       path.normalize(directory).toLowerCase()){
    throw Error("M4 local target contains a redirected directory");
  }
}
async function safeExisting(file:string):Promise<Buffer|null>{
  let before;
  try{before=await lstat(file);}
  catch(e){
    if((e as NodeJS.ErrnoException).code==="ENOENT")return null;
    throw e;
  }
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
     before.size>MAX||
     path.normalize(await realpath(file)).toLowerCase()!==
       path.normalize(file).toLowerCase()){
    throw Error("M4 local note is not an ordinary independent file");
  }
  const contents=await readFile(file);
  const after=await lstat(file);
  if(contents.length!==before.size||after.ino!==before.ino||
     after.size!==before.size||after.mtimeMs!==before.mtimeMs){
    throw Error("M4 local note changed while reading");
  }
  return contents;
}
async function writeExclusive(file:string,bytes:Buffer){
  const fd=await open(file,"wx",0o600);
  try{await fd.writeFile(bytes);await fd.sync();}
  finally{await fd.close();}
}
async function stageBackup(root:string,seq:number,slug:string,prior:Buffer){
  const backupDir=path.join(root,"backups");
  await mkdir(backupDir,{mode:0o700,recursive:false}).catch(e=>{
    if((e as NodeJS.ErrnoException).code!=="EEXIST")throw e;
  });
  await safeFolder(backupDir);
  const backup=path.join(backupDir,
    String(seq).padStart(6,"0")+"-"+slug+".bak");
  await writeExclusive(backup,prior);
  const copied=await safeExisting(backup);
  if(!copied||digest(copied)!==digest(prior)){
    throw Error("M4 durable independent backup not verified");
  }
}
export async function verifyMsiVaultRegistration():Promise<void>{
  if(process.platform!=="win32"||hostname().trim().toUpperCase()!=="MSI"){
    throw Error("M4 local apply restricted to registered MSI Windows");
  }
  const registryPath=path.join(process.env.APPDATA||
    path.join(homedir(),"AppData","Roaming"),"obsidian","obsidian.json");
  const status=await inspectObsidianRegistration({
    vaultPath:APPROVED_MSI_VAULT,registryPath,
  });
  if(!status.registered){
    throw Error("M4 registered MSI Vault is unavailable");
  }
}

/**
 * One note. Caller is responsible for Owner-RLS, reviewed decision, M5 journal
 * lock and after-write remote rechecks. The file operation has NO deletion API.
 */
export async function applyStagedM4ToLocal(args:{
  slug:string;expectedLocalSha:string|null;incoming:Buffer;
  expectedRemoteSha:string;vaultRoot:string;journalRoot:string;seq:number;
}):Promise<{applied:true;beforeLocalSha:string|null;backupSha:string|null}>{
  const {slug,expectedLocalSha,incoming,expectedRemoteSha,vaultRoot,journalRoot,seq}=args;
  if(typeof slug!=="string"||slug.length<3||slug.length>120||!SLUG.test(slug)||
     (expectedLocalSha!==null&&
       (typeof expectedLocalSha!=="string"||!SHA.test(expectedLocalSha)))||
     !Buffer.isBuffer(incoming)||incoming.length<1||incoming.length>MAX||
     !SHA.test(expectedRemoteSha)||digest(incoming)!==expectedRemoteSha||
     !Number.isSafeInteger(seq)||seq<1||seq>20){
    throw Error("M4 requires one reviewed bounded note and exact SHA");
  }
  const markdown=incoming.toString("utf8");
  const parsed=parseObsidianMarkdown(markdown,slug+".md","1970-01-01");
  if(!parsed||parsed.metadata.slug!==slug||
     serializeObsidianMarkdown({...parsed.metadata,content_md:parsed.content_md})!==markdown){
    throw Error("M4 Incoming is not canonical portable Markdown");
  }
  await safeFolder(vaultRoot);
  await safeFolder(journalRoot);
  const filepath=path.join(vaultRoot,slug+".md");
  const original=await safeExisting(filepath);
  const priorSha=original?digest(original):null;
  if(priorSha!==expectedLocalSha){
    throw Error("M4 reviewed local SHA changed before commit");
  }
  if(original){
    await stageBackup(journalRoot,seq,slug,original);
    // The original could have changed during backup IO.
    if(digest((await safeExisting(filepath))??Buffer.alloc(0))!==expectedLocalSha){
      throw Error("M4 local source changed after independent backup");
    }
    const temporary=path.join(vaultRoot,"."+slug+"-"+randomUUID()+".pending");
    let renamed=false;
    try{
      await writeExclusive(temporary,incoming);
      const staged=await safeExisting(temporary);
      if(!staged||digest(staged)!==expectedRemoteSha){
        throw Error("M4 staged local write did not persist correctly");
      }
      if(digest((await safeExisting(filepath))??Buffer.alloc(0))!==expectedLocalSha){
        throw Error("M4 source changed before replacement");
      }
      await rename(temporary,filepath);
      renamed=true;
    }finally{
      if(!renamed)await unlink(temporary).catch(()=>{});
    }
  }else{
    // Never rename over an externally created missing note.
    await writeExclusive(filepath,incoming);
  }
  const after=await safeExisting(filepath);
  if(!after||digest(after)!==expectedRemoteSha){
    throw Error("M4 local write is uncertain; preserve backup and inspect manually");
  }
  return {applied:true,beforeLocalSha:priorSha,backupSha:priorSha};
}

export async function verifyM5LocalBackup(
  root:string,seq:number,slug:string,expectedSha:string,
):Promise<void>{
  const folder=path.join(root,"backups");
  await safeFolder(folder);
  const file=path.join(folder,
    String(seq).padStart(6,"0")+"-"+slug+".bak");
  const bytes=await safeExisting(file);
  if(!bytes||digest(bytes)!==expectedSha){
    throw Error("M5 original backup missing or modified");
  }
}
