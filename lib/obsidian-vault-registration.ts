/**
 * Read-only verification that Obsidian itself registered the Owner-approved
 * existing Vault. Only two configuration-file stat calls plus one bounded
 * Obsidian registry JSON read; no note contents or additional Vault locations
 * are exposed, scanned or modified.
 */
import {lstat,readFile,realpath} from "node:fs/promises";
import path from "node:path";

export type VaultRegistrationStatus={
  registered:boolean;
  configPresent:boolean;
  appConfigPresent:boolean;
  matchedRegistrations:number;
  autoSyncEnabled:false;
};

function normalizeLocation(value:string):string{
  // Obsidian's Windows registry uses the native Windows absolute pathname.
  // win32 normalization permits case-insensitive paths without examining
  // other Vault locations; no substring/prefix matching is allowed.
  return path.win32.normalize(value).replace(/[\\/]+$/,"").toLowerCase();
}

async function isSafeDirectory(directory:string):Promise<boolean>{
  try{
    const stat=await lstat(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink())return false;
    const real=await realpath(directory);
    return path.normalize(real).toLowerCase()===path.normalize(directory).toLowerCase();
  }catch(error){
    if((error as NodeJS.ErrnoException).code==="ENOENT")return false;
    throw error;
  }
}

export async function inspectObsidianRegistration(args:{
  vaultPath:string;
  registryPath:string;
}):Promise<VaultRegistrationStatus>{
  const {vaultPath,registryPath}=args;
  if(!path.isAbsolute(vaultPath)||!path.isAbsolute(registryPath)){
    throw new Error("Obsidian registration paths must both be absolute");
  }
  const root=path.resolve(vaultPath);
  if(!await isSafeDirectory(root)){
    throw new Error("Obsidian Vault root missing, redirected or unsafe");
  }
  const configPath=path.join(root,".obsidian");
  const configPresent=await isSafeDirectory(configPath);
  let appConfigPresent=false;
  if(configPresent){
    try{
      const configFile=await lstat(path.join(configPath,"app.json"));
      appConfigPresent=configFile.isFile()&&!configFile.isSymbolicLink();
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
    }
  }
  let matchedRegistrations=0;
  try{
    const file=await lstat(registryPath);
    if(!file.isFile()||file.isSymbolicLink()||file.size>256_000){
      throw new Error("Obsidian registry is unsafe or exceeds the size limit");
    }
    let json:unknown;
    try{
      const source=await readFile(registryPath,"utf8");
      if(source.length>256_000)throw new Error("Registry expanded during read");
      json=JSON.parse(source) as unknown;
    }catch(error){
      // Native JSON.parse errors can include snippets of user's registry.
      // Never copy those snippets into CLI logs or GitHub test output.
      throw new Error("Invalid or changed Obsidian Vault registry");
    }
    if(!json||typeof json!=="object"||Array.isArray(json)){
      throw new Error("Invalid Obsidian Vault registry");
    }
    const vaults=(json as Record<string,unknown>).vaults;
    if(!vaults||typeof vaults!=="object"||Array.isArray(vaults)){
      throw new Error("Invalid Obsidian Vault registry");
    }
    const expected=normalizeLocation(root);
    for(const record of Object.values(vaults)){
      if(record&&typeof record==="object"&&!Array.isArray(record)){
        const location=(record as Record<string,unknown>).path;
        if(typeof location==="string"&&normalizeLocation(location)===expected){
          matchedRegistrations++;
        }
      }
    }
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  }

  // Duplicate entries are ambiguous: no automatic trust for an unexpected
  // Obsidian registry state. Metadata only, no repair or mutation.
  const registered=configPresent&&appConfigPresent&&matchedRegistrations===1;
  return {registered,configPresent,appConfigPresent,matchedRegistrations,autoSyncEnabled:false};
}
