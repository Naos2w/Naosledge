/**
 * M8 P3a local preference persistence. This stores user intent only: it is
 * never an Agent start authorization and deliberately contains no identity,
 * credential, note, Vault or transport data.
 */
import {homedir,tmpdir} from "node:os";
import {
  lstat,mkdir,open,readFile,realpath,rename,unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";

const TEST_PREFIX="naosledge-m8-preferences-test-";
const FILE="sync-preferences.v1.json";
const KEYS=new Set(["version","enabled","intent"]);

export type M8SyncPreferences={
  version:1;
  enabled:boolean;
  /** A remembered UI preference, never executable state. */
  intent:"stopped"|"paused"|"running";
};
export const DEFAULT_M8_SYNC_PREFERENCES:M8SyncPreferences=Object.freeze({
  version:1,enabled:false,intent:"stopped",
});

function deny():never{
  throw Error("M8 sync preferences unavailable; Agent state unchanged");
}
function canonical(value:M8SyncPreferences){return JSON.stringify(value);}
function validate(value:unknown):M8SyncPreferences{
  if(!value||typeof value!=="object"||Array.isArray(value))deny();
  const item=value as Record<string,unknown>;
  const keys=Object.keys(item);
  if(keys.length!==KEYS.size||keys.some(key=>!KEYS.has(key))||
     item.version!==1||typeof item.enabled!=="boolean"||
     !["stopped","paused","running"].includes(item.intent as string))deny();
  return {
    version:1,enabled:item.enabled,
    intent:item.intent as M8SyncPreferences["intent"],
  };
}
async function safeDirectory(directory:string){
  const stat=await lstat(directory).catch(()=>deny());
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.nlink<1||
     path.normalize(await realpath(directory)).toLowerCase()!==
       path.normalize(directory).toLowerCase())deny();
}
async function safeExistingFile(filename:string){
  const stat=await lstat(filename).catch(()=>deny());
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||
     path.normalize(await realpath(filename)).toLowerCase()!==
       path.normalize(filename).toLowerCase())deny();
}
async function resolveRoot(testRoot?:string){
  if(testRoot!==undefined){
    const resolved=path.resolve(testRoot);
    if(typeof testRoot!=="string"||!path.isAbsolute(testRoot)||
       path.dirname(resolved).toLowerCase()!==path.resolve(tmpdir()).toLowerCase()||
       !path.basename(resolved).startsWith(TEST_PREFIX)||
       !/^[a-zA-Z0-9_-]+$/.test(path.basename(resolved)))deny();
    await safeDirectory(resolved);
    return resolved;
  }
  if(process.platform!=="win32")deny();
  const local=process.env.LOCALAPPDATA||path.join(homedir(),"AppData","Local");
  if(!path.isAbsolute(local))deny();
  await safeDirectory(local);
  const parent=path.join(local,"Naosledge");
  const root=path.join(parent,"m8-sync-preferences");
  for(const directory of [parent,root]){
    try{await mkdir(directory,{mode:0o700});}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=="EEXIST")deny();
    }
    await safeDirectory(directory);
  }
  return root;
}

export type M8SyncPreferenceStore={
  load:()=>Promise<M8SyncPreferences>;
  save:(value:unknown)=>Promise<M8SyncPreferences>;
};

export function createM8SyncPreferenceStore(options?:{
  /** Existing, direct OS TEMP child used only by isolated tests. */
  testOnlyRoot?:string;
  /** Test fault immediately before the atomic replace. */
  testOnlyBeforeCommit?:()=>Promise<void>;
}):M8SyncPreferenceStore{
  if(options!==undefined&&(!options||typeof options!=="object"||
     Array.isArray(options)||Object.keys(options).some(key=>
       key!=="testOnlyRoot"&&key!=="testOnlyBeforeCommit")||
     (options.testOnlyBeforeCommit!==undefined&&
       typeof options.testOnlyBeforeCommit!=="function")))deny();
  async function location(){
    const root=await resolveRoot(options?.testOnlyRoot);
    return {root,filename:path.join(root,FILE)};
  }
  return {
    async load(){
      const {filename}=await location();
      try{await safeExistingFile(filename);}
      catch(error){
        if((error as NodeJS.ErrnoException).code==="ENOENT"){
          return {...DEFAULT_M8_SYNC_PREFERENCES};
        }
        // safeExistingFile deliberately normalizes all failures; check absence
        // without treating permission, symlink or malformed files as defaults.
        try{await lstat(filename);}catch(missing){
          if((missing as NodeJS.ErrnoException).code==="ENOENT")
            return {...DEFAULT_M8_SYNC_PREFERENCES};
        }
        throw error;
      }
      let raw:string;
      try{raw=await readFile(filename,"utf8");}catch{deny();}
      if(Buffer.byteLength(raw)>256)deny();
      let parsed:unknown;
      try{parsed=JSON.parse(raw);}catch{deny();}
      const value=validate(parsed);
      if(raw!==canonical(value))deny();
      return value;
    },
    async save(input){
      const value=validate(input);
      const {root,filename}=await location();
      const staged=path.join(root,`.sync-preferences-${process.pid}-${Date.now()}.tmp`);
      let handle:FileHandle|null=null;
      try{
        // Refuse an unsafe existing destination before staging anything.
        try{await safeExistingFile(filename);}
        catch(error){
          try{await lstat(filename);}catch(missing){
            if((missing as NodeJS.ErrnoException).code==="ENOENT"){
              // A genuinely absent destination is valid.
              throw missing;
            }
          }
          throw error;
        }
      }catch(error){
        if((error as NodeJS.ErrnoException).code!=="ENOENT")deny();
      }
      try{
        handle=await open(staged,"wx",0o600);
        await handle.writeFile(canonical(value),"utf8");
        await handle.sync();
        await handle.close();
        handle=null;
        await safeExistingFile(staged);
        if(await readFile(staged,"utf8")!==canonical(value))deny();
        await options?.testOnlyBeforeCommit?.();
        await rename(staged,filename);
        await safeExistingFile(filename);
        if(await readFile(filename,"utf8")!==canonical(value))deny();
        return value;
      }catch{
        await handle?.close().catch(()=>{});
        await unlink(staged).catch(()=>{});
        deny();
      }
    },
  };
}
