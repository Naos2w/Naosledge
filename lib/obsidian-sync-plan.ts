/**
 * Obsidian two-way reconciliation: PURE, read-only metadata-only planner.
 *
 * No filesystem, Neon, cookies, tokens, private Markdown or network access.
 * Every proposed write needs a future owner-approved executor with optimistic
 * concurrency / backup checks. Never infer deletion or resolve conflicts from
 * modification times.
 */
export type SyncFingerprint={
  slug:string;
  sha256:string;
  revision?:string;
};
export type SyncChoice=
  |"unchanged"
  |"review-upload"|"review-download"
  |"conflict"
  |"review-missing-local"|"review-missing-remote"
  |"both-removed";

export type SyncDecision={
  slug:string;
  choice:SyncChoice;
  manualReview:boolean;
  // Expected fingerprints may be used for future compare-and-swap; no content.
  expectedLocalSha:string|null;
  expectedRemoteSha:string|null;
  expectedRemoteRevision:string|null;
};

export type SyncPlan={
  decisions:SyncDecision[];
  summary:Record<SyncChoice,number>;
  // A separate, owner-approved executor would still be required even for a
  // one-sided update. This planner never attempts automatic side effects.
  autoApplyAllowed:false;
};

const MAX_NOTES=500;
const allowedKeys=new Set(["slug","sha256","revision"]);
const SHA=/^[0-9a-f]{64}$/;
const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REV=/^[a-zA-Z0-9:_-]{1,128}$/;

function validateManifest(value:unknown,label:string):Map<string,SyncFingerprint>{
  if(!Array.isArray(value)||value.length>MAX_NOTES) {
    throw new Error(`${label} manifest must contain 0-${MAX_NOTES} fingerprints`);
  }
  const map=new Map<string,SyncFingerprint>();
  for(const item of value){
    if(!item||typeof item!=="object"||Array.isArray(item)) {
      throw new Error(`${label} contains invalid fingerprint`);
    }
    const obj=item as Record<string,unknown>;
    // Forbid content_md, path, tokens, owner IDs and any unexpected fields.
    if(Object.keys(obj).some(key=>!allowedKeys.has(key))||
       typeof obj.slug!=="string"||obj.slug.length>120||
       !SLUG.test(obj.slug)||typeof obj.sha256!=="string"||!SHA.test(obj.sha256)||
       (obj.revision!==undefined && (
         typeof obj.revision!=="string"||!REV.test(obj.revision)
       ))||map.has(obj.slug)){
      throw new Error(`${label} contains unsafe, duplicate or malformed fingerprint`);
    }
    map.set(obj.slug,{
      slug:obj.slug,sha256:obj.sha256,revision:obj.revision as string|undefined,
    });
  }
  return map;
}

function choose(
  local:SyncFingerprint|undefined,
  remote:SyncFingerprint|undefined,
  base:SyncFingerprint|undefined,
):SyncChoice{
  if(!local&&!remote)return "both-removed";
  if(!local)return "review-missing-local";
  if(!remote)return "review-missing-remote";
  if(local.sha256===remote.sha256)return "unchanged";
  if(!base)return "conflict";

  const localEdited=local.sha256!==base.sha256;
  const remoteEdited=remote.sha256!==base.sha256;
  if(localEdited&&remoteEdited)return "conflict";
  if(localEdited)return "review-upload";
  if(remoteEdited)return "review-download";
  return "conflict"; // A safety fallback, never guess a side to overwrite.
}

export function planObsidianReconciliation(args:{
  local:unknown;remote:unknown;baseline:unknown;
}):SyncPlan{
  if(!args||typeof args!=="object")throw new Error("missing sync manifests");
  const local=validateManifest(args.local,"local");
  const remote=validateManifest(args.remote,"remote");
  const baseline=validateManifest(args.baseline,"baseline");
  const keys=[...new Set([...local.keys(),...remote.keys(),...baseline.keys()])]
    .sort((a,b)=>a<b?-1:a>b?1:0);
  const summary:Record<SyncChoice,number>={
    unchanged:0,"review-upload":0,"review-download":0,conflict:0,
    "review-missing-local":0,"review-missing-remote":0,"both-removed":0,
  };
  const decisions=keys.map(slug=>{
    const l=local.get(slug),r=remote.get(slug),b=baseline.get(slug);
    const choice=choose(l,r,b);
    summary[choice]++;
    return {
      slug,choice,manualReview:choice!=="unchanged"&&choice!=="both-removed",
      expectedLocalSha:l?.sha256??null,
      expectedRemoteSha:r?.sha256??null,
      expectedRemoteRevision:r?.revision??null,
    };
  });
  return {decisions,summary,autoApplyAllowed:false};
}
