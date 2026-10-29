/**
 * M8 MSI host primitive: read-only, non-recursive Obsidian root watcher.
 *
 * No implicit start, no file content access or writes, no network, no note
 * deletion, no credential storage. Merely wakes the existing M8 debouncer.
 * An unseen or missing filename still triggers a FULL subsequent rescan.
 */
import {watch,type FSWatcher} from "node:fs";
import {lstat as statAsync,realpath as resolveAsync} from "node:fs/promises";
import path from "node:path";

type WatcherLike=Pick<FSWatcher,"on"|"close">;
export type WatchFactory=(
  folder:string,callback:(eventType:string,filename:string|Buffer|null)=>void,
)=>WatcherLike;
const actualWatcher:WatchFactory=(folder,notify)=>watch(folder,{
  persistent:false,recursive:false,encoding:"utf8",
},notify);
export function createObsidianRootReadOnlyWatcher(args:{
  root:string;
  onLocalChange:()=>void;
  onError?:()=>void;
  watcherFactory?:WatchFactory;
  signal?:AbortSignal;
}){
  if(!args||typeof args.root!=="string"||!path.isAbsolute(args.root)||
     typeof args.onLocalChange!=="function"||
     (args.onError!==undefined&&typeof args.onError!=="function")||
     (args.watcherFactory!==undefined&&typeof args.watcherFactory!=="function")){
    throw Error("M8 watcher requires an absolute approved root and a callback");
  }
  const root=path.resolve(args.root);
  let watcher:WatcherLike|null=null;
  let starting=false,requests=0;
  const stop=()=>{
    args.signal?.removeEventListener("abort",stop);
    const old=watcher;watcher=null;
    if(old)try{old.close();}catch{}
  };
  const fail=()=>{
    stop();
    try{args.onError?.();}catch{}
  };
  const notify=(eventType:string,_filename:string|Buffer|null)=>{
    if(!watcher||args.signal?.aborted)return;
    // Windows often emits rename for create/remove/rename, and some platforms
    // provide no filename. Both require full reinspection: never infer delete.
    if(eventType!=="rename"&&eventType!=="change")return;
    requests++;
    try{args.onLocalChange();}catch{fail();}
  };
  return {
    async start():Promise<void>{
      if(watcher)return;
      if(starting)throw Error("M8 watcher start already in progress");
      if(args.signal?.aborted)throw Error("M8 watcher canceled");
      starting=true;
      try{
        const before=await statAsync(root);
        const canonical=await resolveAsync(root);
        const after=await statAsync(root);
        if(!before.isDirectory()||before.isSymbolicLink()||
           !after.isDirectory()||after.isSymbolicLink()||
           before.ino!==after.ino||
           path.normalize(canonical).toLowerCase()!==root.toLowerCase()){
          throw Error("M8 watcher refuses a linked, redirected or unstable root");
        }
        if(args.signal?.aborted)throw Error("M8 watcher canceled");
        // Actual fs.watch does not create files or call the cloud.
        const created=(args.watcherFactory??actualWatcher)(root,notify);
        watcher=created;
        created.on("error",fail);
        args.signal?.addEventListener("abort",stop,{once:true});
        if(args.signal?.aborted)stop();
      }finally{starting=false;}
    },
    stop,
    status(){return {started:watcher!==null,requests};},
  };
}
