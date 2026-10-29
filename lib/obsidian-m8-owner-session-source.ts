/**
 * M8 ephemeral owner credential adapter.
 *
 * Calls an externally authenticated provider for EVERY scan. Never caches,
 * persists, logs or exposes a JWT in status. A decoded subject is only a
 * consistency hint: the paired Production journal and M8 inventory perform
 * independent signed-JWT Owner RLS verification.
 */
import {validateProductionOwnerJwt}
  from "./obsidian-m7-production-owner-readonly.ts";

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function createM8EphemeralOwnerSource(options:{
  requestFreshJwt:()=>Promise<string>;
  nowSeconds?:()=>number;
  /** Require at least this long of usable life before the Owner-RLS scan. */
  minRemainingSeconds?:number;
}){
  if(!options||typeof options.requestFreshJwt!=="function"||
     (options.nowSeconds!==undefined&&typeof options.nowSeconds!=="function")){
    throw Error("M8 authenticated Owner provider unavailable");
  }
  const remaining=options.minRemainingSeconds??90;
  if(!Number.isSafeInteger(remaining)||remaining<30||remaining>600){
    throw Error("M8 credential safety margin invalid");
  }
  const now=options.nowSeconds??(()=>Math.floor(Date.now()/1000));
  let ownerId:string|null=null;
  let acquisitions=0;
  return {
    async acquire():Promise<string>{
      let token:unknown;
      try{token=await options.requestFreshJwt();}
      catch{throw Error("M8 Owner session refresh unavailable");}
      try{
        const clock=now();
        if(!Number.isSafeInteger(clock)||clock<=0)throw Error();
        // The validator accepts only short-lived, non-expired Production JWT.
        const sub=validateProductionOwnerJwt(token,clock+remaining);
        if(!UUID.test(sub))throw Error();
        if(ownerId!==null&&sub!==ownerId)throw Error();
        if(ownerId===null)ownerId=sub;
        acquisitions++;
        return token as string;
      }catch{
        // Do not reveal JWT, expiry, owner identity, source error or headers.
        throw Error("M8 Owner session is invalid, expired or changed");
      }
    },
    status(){
      // No token, owner UUID, expiry time or session provider diagnostics.
      return {ownerPinned:ownerId!==null,successfulAcquisitions:acquisitions,
        storedTokens:0,automaticTransfersEnabled:false as const};
    },
  };
}
