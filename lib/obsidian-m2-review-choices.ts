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

function assertReviewOnly(preview:ManualReviewPreview):void{
  if(!preview||preview.sandboxOnly!==true||preview.readOnly!==true||
     preview.manualTriggerOnly!==true||preview.autoApplyAllowed!==false||
     preview.automaticDeleteEnabled!==false||preview.automaticSyncEnabled!==false||
     preview.baselinePersisted!==false||!Array.isArray(preview.decisions)||
     preview.decisions.length>500){
    throw Error("M2 requires a complete read-only M1 preview");
  }
  const slugs=new Set<string>();
  for(const row of preview.decisions){
    if(!row||typeof row.slug!=="string"||slugs.has(row.slug)||
       row.writeAllowed!==false||row.deleteAllowed!==false||
       row.perNoteConfirmationRequired!==
          (row.choice!=="unchanged"&&row.choice!=="both-removed")){
      throw Error("M2 cannot accept an unsafe or duplicate review row");
    }
    reviewIntentOptions(row.choice);
    slugs.add(row.slug);
  }
}

export function chooseReviewIntent(
  preview:ManualReviewPreview,
  current:ReviewIntentSelections,
  slug:string,
  intent:ReviewIntent,
):ReviewIntentSelections{
  assertReviewOnly(preview);
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
  if(!selected||typeof selected!=="object"||Array.isArray(selected)) {
    throw Error("Invalid M2 selection state");
  }
  const bySlug=new Map(preview.decisions.map(x=>[x.slug,x]));
  for(const [slug,intent] of Object.entries(selected)){
    const decision=bySlug.get(slug);
    if(!decision||!reviewIntentOptions(decision.choice).includes(intent)){
      throw Error("M2 selection does not match the inspected M1 preview");
    }
  }
  const reviewable=preview.decisions.filter(d=>reviewIntentOptions(d.choice).length>0);
  const selections=reviewable.map(d=>selected[d.slug]).filter(Boolean);
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
