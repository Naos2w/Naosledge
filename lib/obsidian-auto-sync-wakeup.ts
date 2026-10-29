/**
 * Lightweight wake-up coordinator for the future Windows sync agent.
 *
 * This DOES NOT watch a real Vault, connect to Neon, persist credentials,
 * execute sync transfers, or start on import. The future trusted host must
 * explicitly call start() and provide a read-only scan/plan callback first.
 * One scan at a time; local events coalesce; remote metadata is polled only
 * after the prior scan completes; failures retry with bounded backoff.
 */
export type AutoSyncScanTrigger="startup"|"local-change"|"poll"|"retry";
export type AutoSyncSchedulerStatus={
  started:boolean;
  scanInFlight:boolean;
  localChangePending:boolean;
  consecutiveFailures:number;
  lastResult:"never"|"success"|"error";
};
export type AutoSyncClock={
  set:(callback:()=>void,delayMs:number)=>unknown;
  clear:(handle:unknown)=>void;
};
const realClock:AutoSyncClock={
  set:(callback,ms)=>setTimeout(callback,ms),
  clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export function createObsidianAutoSyncWakeup(options:{
  /** Must only perform read-only, versioned inventory/planning until approved. */
  onCheck:(signal:AbortSignal,trigger:AutoSyncScanTrigger)=>Promise<void>;
  clock?:AutoSyncClock;
  pollMs?:number;
  debounceMs?:number;
  retryMs?:number;
}){
  if(!options||typeof options.onCheck!=="function")throw Error("Auto-sync scan is required");
  const clock=options.clock??realClock;
  if(typeof clock.set!=="function"||typeof clock.clear!=="function"){
    throw Error("Auto-sync clock invalid");
  }
  const pollMs=options.pollMs??60_000;
  const debounceMs=options.debounceMs??800;
  const retryMs=options.retryMs??5_000;
  if(!Number.isSafeInteger(pollMs)||pollMs<60_000||pollMs>600_000||
     !Number.isSafeInteger(debounceMs)||debounceMs<250||debounceMs>5_000||
     !Number.isSafeInteger(retryMs)||retryMs<1_000||retryMs>60_000){
    throw Error("Auto-sync cadence must be low-load and bounded");
  }
  let started=false,inFlight=false,pending=false,failures=0;
  let timer:unknown=null,controller:AbortController|null=null;
  let lastResult:AutoSyncSchedulerStatus["lastResult"]="never";

  const clearTimer=()=>{
    if(timer!==null){clock.clear(timer);timer=null;}
  };
  const schedule=(delay:number,trigger:AutoSyncScanTrigger)=>{
    if(!started)return;
    clearTimer();
    timer=clock.set(()=>{
      timer=null;
      void scan(trigger);
    },delay);
  };
  const backoff=()=>Math.min(300_000,retryMs*2**Math.min(10,Math.max(0,failures-1)));
  async function scan(trigger:AutoSyncScanTrigger):Promise<void>{
    if(!started)return;
    if(inFlight){pending=true;return;}
    inFlight=true;
    const active=new AbortController();
    controller=active;
    try{
      await options.onCheck(active.signal,trigger);
      if(started&&!active.signal.aborted){
        failures=0;lastResult="success";
      }
    }catch{
      // Never serialize a potentially sensitive remote error, URL or JWT.
      if(started&&!active.signal.aborted){
        failures=Math.min(1000,failures+1);lastResult="error";
      }
    }finally{
      if(controller===active)controller=null;
      inFlight=false;
      if(!started)return;
      if(pending){
        pending=false;
        // One coalesced local check, not a retry storm after a remote error.
        schedule(failures?backoff():debounceMs,
          failures?"retry":"local-change");
      }else{
        schedule(failures?backoff():pollMs,failures?"retry":"poll");
      }
    }
  }
  return {
    /** Explicit opt-in only; no module-level process, Cron or timer. */
    start():void{
      if(started)return;
      if(inFlight)throw Error("Previous auto-sync scan has not stopped");
      started=true;pending=false;failures=0;
      lastResult="never";
      schedule(0,"startup");
    },
    signalLocalChange():void{
      if(!started)return;
      if(inFlight){pending=true;return;}
      schedule(failures?backoff():debounceMs,
        failures?"retry":"local-change");
    },
    stop():void{
      started=false;pending=false;
      clearTimer();
      controller?.abort();
    },
    status():AutoSyncSchedulerStatus{
      return {
        started,scanInFlight:inFlight,localChangePending:pending,
        consecutiveFailures:failures,lastResult,
      };
    },
  };
}
