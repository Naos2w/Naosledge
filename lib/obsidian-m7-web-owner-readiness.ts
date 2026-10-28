/**
 * M7 Production web-session preflight. A server component must first call
 * requireVault(): it authenticates the Neon session and verifies the user's
 * blog_admins grant through the member JWT / RLS.
 *
 * This helper uses the resulting Owner-scoped client solely to count notes.
 * It never creates or transfers notes, reads Markdown, saves a baseline, or
 * enables the Sandbox-only M2 approval workflow.
 */
import {
  productionReleaseIntent,validateProductionRelease,
  type ReleaseRuntime,
} from "./neon/production-release.ts";

export type M7WebOwnerReadiness=
  | {state:"not-production"}
  | {state:"unavailable"}
  | {
    state:"verified";
    remoteNotes:number;
    remoteFullInventoryRead:false;
    noteBodiesRead:false;
    comparisonPerformed:false;
    transferAllowed:false;
    baselineSaved:false;
  };

export type M7WebOwnerCountResponse={
  data:unknown;
  count:number|null;
  error:unknown;
};

const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

/**
 * This does not establish identity by itself. The only caller must have
 * successfully completed requireVault() BEFORE passing the read callback.
 * No untrusted browser input, endpoint, branch, token, or URL is accepted.
 */
export async function observeM7ProductionOwnerWebReadiness(args:{
  environment:ReleaseRuntime;
  ownerRlsCount:()=>Promise<M7WebOwnerCountResponse>;
}):Promise<M7WebOwnerReadiness>{
  if(!productionReleaseIntent(args.environment)){
    return {state:"not-production"};
  }
  try{
    // Block even read-only status if this website is not the exact approved
    // Production deployment + paired Neon Auth and Data API configuration.
    validateProductionRelease(args.environment);
  }catch{
    return {state:"unavailable"};
  }
  try{
    const result=await args.ownerRlsCount();
    // Never infer a complete list from the first page, unknown count, or a
    // successful HTTP response without an exact total.
    if(result.error!==null||!Number.isSafeInteger(result.count)||
       result.count===null||result.count<0||result.count>1_000_000||
       !Array.isArray(result.data)||
       result.data.length!==(result.count===0?0:1)){
      return {state:"unavailable"};
    }
    if(result.data.length===1){
      const row=result.data[0];
      if(!row||typeof row!=="object"||Array.isArray(row)||
         Object.keys(row).length!==1||
         typeof (row as Record<string,unknown>).id!=="string"||
         !UUID.test((row as Record<string,string>).id)){
        return {state:"unavailable"};
      }
    }
    return {
      state:"verified",remoteNotes:result.count,
      remoteFullInventoryRead:false,noteBodiesRead:false,
      comparisonPerformed:false,transferAllowed:false,baselineSaved:false,
    };
  }catch{
    // Remote failures must not leak private note data or JWTs into HTML.
    return {state:"unavailable"};
  }
}
