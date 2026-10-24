/**
 * M2 review-intent-only state: never a transfer command, token or authorization.
 * UI uses this pure mapping with M1 fingerprint decisions. No filesystem, DB,
 * localStorage, server actions, network or operation/executor endpoints.
 */
import type {ManualReviewPreview} from "./obsidian-manual-sync-review.ts";
import type {SyncChoice} from "./obsidian-sync-plan.ts";

export type ReviewIntent="upload"|"download"|"keep-both"|"skip";
export type ReviewIntentSelections=Record<string,ReviewIntent>;
export type ReviewIntentSummary={
  total:number;
  needsReview:number;
  selected:number;
  pending:number;
  upload:number;
  download:number;
  keepBoth:number;
  skipped:number;
  nonExecutable:true;
};

const OPTIONS:Readonly<Record<SyncChoice,readonly ReviewIntent[]>>={
  unchanged:[],
  "review-upload":["upload","skip"],
  "review-missing-remote":["upload","skip"],
  "review-download":["download","skip"],
  "review-missing-local":["download","skip"],
  conflict:["keep-both","skip"],
  "both-removed":[],
};

export function reviewIntentOptions(choice:SyncChoice):readonly ReviewIntent[]{
  if(!Object.hasOwn(OPTIONS,choice))throw Error("Unknown reconciliation choice");
  return OPTIONS[choice];
}

const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA=/^[0-9a-f]{64}$/;
const REVISION=/^[a-zA-Z0-9:_-]{1,128}$/;
const DECISION_FIELDS=[
  "slug","choice","manualReview","expectedLocalSha","expectedRemoteSha",
  "expectedRemoteRevision","perNoteConfirmationRequired","writeAllowed","deleteAllowed",
];
const INVENTORY_FIELDS=[
  "localSupportedNotes","remoteNotes","remoteFullInventory",
  "localUnsupportedMarkdown","localOtherFiles","localDirectoriesNotScanned",
  "localCoverageNeedsReview",
];
function count(value:unknown):value is number{
  return typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
}
function exactFields(value:unknown,fields:readonly string[]):boolean{
  return !!value&&typeof value==="object"&&!Array.isArray(value)&&
    Object.keys(value).length===fields.length&&
    Object.keys(value).every(key=>fields.includes(key));
}
function expectedSides(choice:SyncChoice,local:string|null,remote:string|null):boolean{
  if(choice==="both-removed")return local===null&&remote===null;
  if(choice==="review-missing-local")return local===null&&remote!==null;
  if(choice==="review-missing-remote")return local!==null&&remote===null;
  if(choice==="unchanged")return local!==null&&remote===local;
  return local!==null&&remote!==null&&local!==remote;
}

/**
 * The M2 UI may eventually consume a manual MSI/Neon read-only snapshot.
 * Verify the entire M1 summary here before displaying or storing selections;
 * a partial inventory or mismatched counts must NEVER appear as a full review.
 */
function assertReviewOnly(preview:ManualReviewPreview):void{
  if(!preview||preview.sandboxOnly!==true||preview.readOnly!==true||
     preview.manualTriggerOnly!==true||preview.autoApplyAllowed!==false||
     preview.automaticDeleteEnabled!==false||preview.automaticSyncEnabled!==false||
     preview.baselinePersisted!==false||!Array.isArray(preview.decisions)||
     preview.decisions.length>500){
    throw Error("M2 requires a complete read-only M1 preview");
  }
  const inv=preview.inventory;
  const statuses=Object.keys(OPTIONS) as SyncChoice[];
  if(!exactFields(inv,INVENTORY_FIELDS)||!exactFields(preview.summary,statuses)||
     !count(inv.localSupportedNotes)||inv.localSupportedNotes>500||
     !count(inv.remoteNotes)||inv.remoteNotes>20||
     !count(inv.localUnsupportedMarkdown)||!count(inv.localOtherFiles)||
     !count(inv.localDirectoriesNotScanned)||inv.remoteFullInventory!==true||
     !count(preview.manualReviewCount)||!count(preview.conflicts)||
     !count(preview.possibleDeletionsNeverApplied)||
     statuses.some(s=>!count(preview.summary[s]))){
    throw Error("M2 requires complete, bounded M1 inventory and summary");
  }
  const uncovered=inv.localUnsupportedMarkdown>0||inv.localDirectoriesNotScanned>0;
  if(inv.localCoverageNeedsReview!==uncovered||
     preview.previewStatus!==(uncovered?"partial-local-coverage":"ready")){
    throw Error("M2 cannot hide partial local coverage");
  }
  const slugs=new Set<string>();
  const observed=Object.fromEntries(statuses.map(s=>[s,0])) as Record<SyncChoice,number>;
  let localCount=0,remoteCount=0,reviewCount=0;
  for(const row of preview.decisions){
    if(!exactFields(row,DECISION_FIELDS)||typeof row.slug!=="string"||
       row.slug.length>120||!SLUG.test(row.slug)||slugs.has(row.slug)||
       (row.expectedLocalSha!==null&&
         (typeof row.expectedLocalSha!=="string"||!SHA.test(row.expectedLocalSha)))||
       (row.expectedRemoteSha!==null&&
         (typeof row.expectedRemoteSha!=="string"||!SHA.test(row.expectedRemoteSha)))||
       (row.expectedRemoteRevision!==null&&
         (typeof row.expectedRemoteRevision!=="string"||!REVISION.test(row.expectedRemoteRevision)))||
       ((row.expectedRemoteSha===null)!==(row.expectedRemoteRevision===null))||
       row.writeAllowed!==false||row.deleteAllowed!==false||
       row.manualReview!==(row.choice!=="unchanged"&&row.choice!=="both-removed")||
       row.perNoteConfirmationRequired!==row.manualReview){
      throw Error("M2 cannot accept an unsafe or duplicate review row");
    }
    reviewIntentOptions(row.choice);
    if(!expectedSides(row.choice,row.expectedLocalSha,row.expectedRemoteSha)){
      throw Error("M2 note fingerprints contradict the stated review direction");
    }
    if(row.expectedLocalSha!==null)localCount++;
    if(row.expectedRemoteSha!==null)remoteCount++;
    if(row.manualReview)reviewCount++;
    observed[row.choice]++;
    slugs.add(row.slug);
  }
  if(inv.localSupportedNotes!==localCount||inv.remoteNotes!==remoteCount||
     preview.manualReviewCount!==reviewCount||
     preview.conflicts!==observed.conflict||
     preview.possibleDeletionsNeverApplied!==
       observed["both-removed"]+observed["review-missing-local"]+
       observed["review-missing-remote"]||
     statuses.some(s=>observed[s]!==preview.summary[s])){
    throw Error("M2 preview rows and M1 summary do not match");
  }
}

function assertSelectionSet(
  preview:ManualReviewPreview,selected:ReviewIntentSelections,
):void{
  if(!selected||typeof selected!=="object"||Array.isArray(selected)){
    throw Error("Invalid M2 selection state");
  }
  const bySlug=new Map(preview.decisions.map(x=>[x.slug,x]));
  for(const [slug,intent] of Object.entries(selected)){
    const decision=bySlug.get(slug);
    if(!decision||!reviewIntentOptions(decision.choice).includes(intent)){
      throw Error("M2 selection does not match the inspected M1 preview");
    }
  }
}

export function chooseReviewIntent(
  preview:ManualReviewPreview,
  current:ReviewIntentSelections,
  slug:string,
  intent:ReviewIntent,
):ReviewIntentSelections{
  assertReviewOnly(preview);
  assertSelectionSet(preview,current);
  const decision=preview.decisions.find(d=>d.slug===slug);
  if(!decision||!reviewIntentOptions(decision.choice).includes(intent)){
    throw Error("M2 does not allow this direction or conflict overwrite");
  }
  // Fresh object, safe own keys only. No action gets dispatched anywhere.
  return {...current,[slug]:intent};
}

export function summariseReviewIntents(
  preview:ManualReviewPreview,
  selected:ReviewIntentSelections,
):ReviewIntentSummary{
  assertReviewOnly(preview);
  assertSelectionSet(preview,selected);
  const reviewable=preview.decisions.filter(d=>reviewIntentOptions(d.choice).length>0);
  // Only OWN selections count. A valid slug such as "constructor" is also an
  // inherited Object.prototype property on an ordinary {} selection map.
  const selections=reviewable.filter(d=>Object.hasOwn(selected,d.slug))
    .map(d=>selected[d.slug]);
  return {
    total:preview.decisions.length,
    needsReview:reviewable.length,
    selected:selections.length,
    pending:reviewable.length-selections.length,
    upload:selections.filter(x=>x==="upload").length,
    download:selections.filter(x=>x==="download").length,
    keepBoth:selections.filter(x=>x==="keep-both").length,
    skipped:selections.filter(x=>x==="skip").length,
    nonExecutable:true,
  };
}
