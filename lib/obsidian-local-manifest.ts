/**
 * Bounded read-only Obsidian folder fingerprinting for MSI sync dry-runs.
 *
 * No Neon/HTTP/auth, file writes, rename, delete, recursion, file contents
 * in output, or automatic sync. Read only immediate safe-slug .md files.
 * Unknown Obsidian names/subfolders remain untouched and are counted for
 * future manual mapping; don't silently claim they were synced.
 */
import {createHash} from "node:crypto";
import {lstat,readFile,readdir,realpath} from "node:fs/promises";
import path from "node:path";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";

const MAX_FILES=500;
const MAX_FILE_BYTES=250_000;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ReadOnlyLocalManifest={
  fingerprints:SyncFingerprint[];
  unsupportedMarkdownFiles:number;
  otherFiles:number;
  directoriesNotScanned:number;
  autoApplyAllowed:false;
};

export async function readObsidianLocalManifest(folder:string):Promise<ReadOnlyLocalManifest>{
  if(typeof folder!=="string"||!path.isAbsolute(folder)){
    throw new Error("Obsidian folder must be an absolute local path");
  }
  const root=path.resolve(folder);
  const stat=await lstat(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()){
    throw new Error("Obsidian root must be a real directory, not a link");
  }
  // The root may not be redirected through a junction/symlink.
  const resolved=await realpath(root);
  if(path.normalize(resolved).toLowerCase()!==path.normalize(root).toLowerCase()){
    throw new Error("Obsidian directory contains a reparse redirect");
  }
  const children=await readdir(root,{withFileTypes:true});
  const md=children.filter(x=>/\.md$/i.test(x.name));
  if(md.length>MAX_FILES)throw new Error("Obsidian folder exceeds 500 Markdown files");

  const fingerprints:SyncFingerprint[]=[];
  let unsupportedMarkdownFiles=0;
  let otherFiles=0;
  let directoriesNotScanned=0;
  for(const child of children.sort((a,b)=>a.name.localeCompare(b.name,"en"))){
    // Only the real standard config directory is excluded from note coverage.
    // Never traverse it or exempt a same-named symlink/junction.
    if(child.name===".obsidian"&&(child.isDirectory()||child.isSymbolicLink())){
      const config=path.join(root,child.name);
      const configStat=await lstat(config);
      if(!configStat.isDirectory()||configStat.isSymbolicLink()||
         path.normalize(await realpath(config))!==path.normalize(config)){
        throw new Error("Obsidian config directory must not be a link or redirect");
      }
      continue;
    }
    // A linked folder may hide Markdown outside this root. Treating it as an
    // ordinary "other file" would falsely mark local note coverage complete.
    if(child.isSymbolicLink()){
      throw new Error("Obsidian root symlinks or junctions cannot be scanned safely");
    }
    if(child.isDirectory()){
      directoriesNotScanned++;
      continue;
    }
    if(!/\.md$/i.test(child.name)){
      otherFiles++;
      continue;
    }
    const slug=child.name.slice(0,-3);
    if(!SLUG.test(slug)||slug.length<3||slug.length>120){
      unsupportedMarkdownFiles++;
      continue;
    }
    if(!child.isFile()){
      throw new Error("Obsidian Markdown entries must be regular files");
    }

    const full=path.join(root,child.name);
    const before=await lstat(full);
    if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||
       before.size>MAX_FILE_BYTES){
      throw new Error("Obsidian Markdown file is unsafe, hardlinked or exceeds the 250KB limit");
    }
    const actual=await realpath(full);
    if(path.normalize(actual).toLowerCase()!==path.normalize(full).toLowerCase()){
      throw new Error("Obsidian Markdown path unexpectedly redirected");
    }
    const bytes=await readFile(full);
    const after=await lstat(full);
    if(bytes.length>MAX_FILE_BYTES||after.size!==before.size||
       after.mtimeMs!==before.mtimeMs||after.ino!==before.ino){
      throw new Error("Obsidian Markdown changed during fingerprinting");
    }
    fingerprints.push({
      slug,sha256:createHash("sha256").update(bytes).digest("hex"),
    });
  }
  fingerprints.sort((a,b)=>a.slug<b.slug?-1:a.slug>b.slug?1:0);
  return {
    fingerprints,unsupportedMarkdownFiles,otherFiles,directoriesNotScanned,
    autoApplyAllowed:false,
  };
}
