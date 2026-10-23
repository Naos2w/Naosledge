/**
 * M2 DISPLAY FIXTURE ONLY. Invented fingerprints; zero real Vault/Neon reads.
 * Kept separate from the M1 approved MSI reader and any production route.
 */
import {createHash} from "node:crypto";
import {previewManualObsidianSync,type ManualReviewPreview} from "./obsidian-manual-sync-review.ts";
import type {SyncFingerprint} from "./obsidian-sync-plan.ts";

const sha=(content:string)=>createHash("sha256").update("M2 synthetic: "+content).digest("hex");
const note=(slug:string,version:string,revision?:string):SyncFingerprint=>({
  slug,sha256:sha(slug+":"+version),...(revision?{revision}:{}),
});

/** Safe, deterministic samples for visual interaction tests only. */
export async function makeSyntheticM2Preview():Promise<ManualReviewPreview>{
  return previewManualObsidianSync({
    baseline:[
      note("react-hooks","v1"),
      note("nextjs-routing","v1"),
      note("typescript-notes","v1"),
      note("already-synced","v1"),
      note("removed-both","v1"),
    ],
    readLocal:async()=>({
      fingerprints:[
        note("react-hooks","v2"),
        note("nextjs-routing","v1"),
        note("typescript-notes","local-v2"),
        note("local-new","v1"),
        note("already-synced","v1"),
      ],
      unsupportedMarkdownFiles:0,otherFiles:0,directoriesNotScanned:0,
      autoApplyAllowed:false,
    }),
    readRemote:async()=>({
      fingerprints:[
        note("react-hooks","v1","demo-r1"),
        note("nextjs-routing","v2","demo-r2"),
        note("typescript-notes","remote-v2","demo-r3"),
        note("remote-new","v1","demo-r4"),
        note("already-synced","v1","demo-r5"),
      ],
      numberOfNotes:5,sandboxOnly:true,rlsEnforcedByDataApi:true,
      writeEnabled:false,fullInventory:true,
    }),
  });
}
