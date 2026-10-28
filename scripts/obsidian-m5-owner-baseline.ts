/**
 * MSI-only manual review, one approved Sandbox upload and M5 Baseline.
 * The upload mode calls the existing M3 CAS transport; the other modes only
 * observe/adopt current equality. Never accesses Production, writes the Vault
 * or schedules background sync.
 *
 * No tokens or private note bodies on argv/env/disk/logs. The caller supplies
 * a short-lived Neon Integration Sandbox Owner JWT over private stdin.
 */
import {hostname} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  adoptM5CurrentEquality,inspectM5OwnerApprovedBaseline,
  assertM5ApprovedBaselineInvocation,readM5ApprovedReview,
  uploadReviewedM3AndRecordM5,
} from "../lib/obsidian-m5-owner-baseline-journal.ts";
import {parseManualM3UploadIntent} from "../lib/obsidian-m2-review-choices.ts";
import {saveManualM2Handoff} from "./obsidian-msi-manual-preview.ts";

export const M5_ADOPT="--m5-adopt-current-equality";
export const M5_INSPECT="--m5-inspect-approved-baseline";
export const M5_REVIEW="--m5-review-approved-baseline";
export const M5_UPLOAD="--m5-upload-reviewed-note";
type Request={
  sandboxOwnerJwt:string;
  slug?:string;sha256?:string;remoteRevision?:string;
  typedConfirmation?:string;handoff?:unknown;
};
export async function readM5ApprovedBaselineRequest(
  input:AsyncIterable<string|Uint8Array>,mode:string,
):Promise<Request>{
  let size=0;
  const chunks:Buffer[]=[];
  for await(const part of input){
    const bytes=typeof part==="string"?Buffer.from(part):Buffer.from(part);
    size+=bytes.byteLength;
    if(size>10_000)throw Error("M5 owner request too large");
    chunks.push(bytes);
  }
  let value:unknown;
  try{value=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw Error("M5 owner request must be JSON");}
  if(!value||typeof value!=="object"||Array.isArray(value)){
    throw Error("M5 owner request invalid");
  }
  const r=value as Record<string,unknown>;
  const fields=mode===M5_ADOPT?[
    "sandboxOwnerJwt","slug","sha256","remoteRevision","typedConfirmation",
  ]:mode===M5_UPLOAD?[
    "sandboxOwnerJwt","handoff","typedConfirmation",
  ]:[M5_INSPECT,M5_REVIEW].includes(mode)?["sandboxOwnerJwt"]:[];
  if(!fields.length||Object.keys(r).length!==fields.length||
     !fields.every(key=>Object.hasOwn(r,key))||
     typeof r.sandboxOwnerJwt!=="string"||r.sandboxOwnerJwt.length>8192||
     !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(r.sandboxOwnerJwt)){
    throw Error("M5 owner request fields invalid");
  }
  if(mode===M5_ADOPT&&(
    typeof r.slug!=="string"||r.slug.length<3||r.slug.length>120||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.slug)||
    typeof r.sha256!=="string"||!/^[a-f0-9]{64}$/.test(r.sha256)||
    typeof r.remoteRevision!=="string"||!/^[a-f0-9]{64}$/.test(r.remoteRevision)||
    typeof r.typedConfirmation!=="string"||r.typedConfirmation.length>210||
    r.typedConfirmation!=="ADOPT M5 SANDBOX "+r.slug+" "+r.sha256.slice(0,12)
  )){
    throw Error("M5 requires specific manual adoption confirmation");
  }
  if(mode===M5_UPLOAD){
    const d=parseManualM3UploadIntent(r.handoff);
    if(typeof r.typedConfirmation!=="string"||
       r.typedConfirmation!=="UPLOAD M5 SANDBOX "+d.slug+" "+
         d.expectedLocalSha!.slice(0,12)){
      throw Error("M5 upload requires explicit per-note review and confirmation");
    }
  }
  return r as Request;
}

const executed=process.argv[1]?
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url):false;
if(executed){
  try{
    const flag=process.argv[2];
    assertM5ApprovedBaselineInvocation(
      process.platform,hostname(),process.argv.slice(2),!!process.stdin.isTTY,
    );
    const r=await readM5ApprovedBaselineRequest(process.stdin,flag);
    if(flag===M5_ADOPT){
      const event=await adoptM5CurrentEquality({
        sandboxOwnerJwt:r.sandboxOwnerJwt,slug:r.slug!,
        sha256:r.sha256!,remoteRevision:r.remoteRevision!,
        typedConfirmation:r.typedConfirmation!,
      });
      if(!event.baselineSaved||event.transferConfirmed||event.autoApplyAllowed){
        throw Error("M5 event authority mismatch");
      }
      console.log("M5_OWNER_ADOPTED_EQUAL_BASELINE_PERSISTED count="+event.entryCount);
      console.log("EXPLICIT_CURRENT_ADOPTION_ONLY; NOT_PAST_TRANSFER; NO_AUTO_SYNC");
    }else if(flag===M5_UPLOAD){
      const verified=await uploadReviewedM3AndRecordM5({
        sandboxOwnerJwt:r.sandboxOwnerJwt,handoff:r.handoff,
        typedConfirmation:r.typedConfirmation!,
      });
      if(verified.baselineSaved!==true||verified.transferConfirmed!==true||
         verified.autoApplyAllowed!==false||verified.deleteAllowed!==false){
        throw Error("M5 upload returned unexpected authority");
      }
      console.log("M3_M5_SANDBOX_UPLOAD_AND_BASELINE_VERIFIED count="+
        verified.entryCount);
      console.log("MANUAL_OWNER_APPROVAL; NO_VAULT_WRITE; NO_AUTO_DELETE");
    }else if(flag===M5_REVIEW){
      const verified=await readM5ApprovedReview({
        sandboxOwnerJwt:r.sandboxOwnerJwt,
      });
      const file=await saveManualM2Handoff(verified);
      console.log("M2_APPROVED_BASELINE_READONLY_HANDOFF "+file);
      console.log("REVIEW_IN_BROWSER; NO_TRANSMISSION; NO_AUTO_APPLY");
    }else if(flag===M5_INSPECT){
      const result=await inspectM5OwnerApprovedBaseline({
        sandboxOwnerJwt:r.sandboxOwnerJwt,
      });
      console.log("M5_AUTHENTICATED_BASELINE_PRESENT count="+result.baselineCount);
      console.log("M5_CURRENT_MANUAL_REVIEW_COUNT "+result.manualReviewCount);
      console.log("M5_CURRENT_CONFLICT_COUNT "+result.conflicts);
      console.log("M5_POSSIBLE_DELETIONS_NEVER_APPLIED "+
        result.possibleDeletionsNeverApplied);
      console.log("READONLY_RECOVERY_INSPECTION; NO_AUTO_APPLY; NO_DELETE");
    }
  }catch{
    // No JWT, slug, note bytes or full OS private path ever printed.
    console.error(process.argv[2]===M5_UPLOAD?
      "M3_M5_UPLOAD_NOT_VERIFIED; REMOTE_MAY_HAVE_COMMITTED; NO_RETRY":
      "M5_OWNER_BASELINE_NOT_VERIFIED; NO_AUTO_SYNC");
    process.exitCode=1;
  }
}
