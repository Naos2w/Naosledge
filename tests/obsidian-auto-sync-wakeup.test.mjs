import test from "node:test";
import assert from "node:assert/strict";
import {createObsidianAutoSyncWakeup} from "../lib/obsidian-auto-sync-wakeup.ts";

class FakeClock{
  now=0;id=0;tasks=new Map();
  set=(fn,ms)=>{
    const token=++this.id;
    this.tasks.set(token,{at:this.now+ms,fn});
    return token;
  };
  clear=id=>{this.tasks.delete(id);};
  async advance(ms){
    const target=this.now+ms;
    for(let tries=0;tries<100;tries++){
      const task=[...this.tasks.entries()]
        .filter(([,value])=>value.at<=target)
        .sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!task)break;
      this.now=task[1].at;
      this.tasks.delete(task[0]);
      task[1].fn();
      for(let i=0;i<8;i++)await Promise.resolve();
    }
    this.now=target;
    for(let i=0;i<8;i++)await Promise.resolve();
  }
}
const setup=(callback,config={})=>{
  const clock=new FakeClock();
  const scheduler=createObsidianAutoSyncWakeup({
    clock,onCheck:callback,...config,
  });
  return {clock,scheduler};
};
test("scheduler never starts itself: no remote calls or timers on import",async()=>{
  const calls=[];
  const {clock,scheduler}=setup(async(_,trigger)=>calls.push(trigger));
  assert.equal(scheduler.status().started,false);
  assert.equal(clock.tasks.size,0);
  scheduler.signalLocalChange();
  await clock.advance(100_000);
  assert.equal(calls.length,0);
  scheduler.stop();
  assert.equal(clock.tasks.size,0);
});

test("after explicit start, one startup read then metadata polls every >=60 seconds",async()=>{
  const calls=[];
  const {clock,scheduler}=setup(async(signal,trigger)=>{
    assert.equal(signal.aborted,false);
    calls.push([clock.now,trigger]);
  });
  scheduler.start();scheduler.start();
  await clock.advance(0);
  assert.deepEqual(calls,[[0,"startup"]]);
  await clock.advance(59_999);
  assert.equal(calls.length,1);
  await clock.advance(1);
  assert.deepEqual(calls,[[0,"startup"],[60_000,"poll"]]);
  assert.deepEqual(scheduler.status(),{
    started:true,scanInFlight:false,localChangePending:false,
    consecutiveFailures:0,lastResult:"success",
  });
  scheduler.stop();
  assert.equal(clock.tasks.size,0);
});

test("bursty local filesystem events coalesce into exactly one delayed scan",async()=>{
  const calls=[];
  const {clock,scheduler}=setup(async(_,reason)=>calls.push([clock.now,reason]));
  scheduler.start();
  await clock.advance(0);
  scheduler.signalLocalChange();
  await clock.advance(200);
  scheduler.signalLocalChange();
  await clock.advance(200);
  scheduler.signalLocalChange();
  await clock.advance(799);
  assert.equal(calls.length,1);
  await clock.advance(1);
  assert.deepEqual(calls,[
    [0,"startup"],
    [1200,"local-change"],
  ]);
  scheduler.stop();
});

test("single-flight scan has one queued recheck even after repeated local events",async()=>{
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  const calls=[];
  const {clock,scheduler}=setup(async(signal,why)=>{
    calls.push(why);
    if(calls.length===1)await held;
    assert.equal(signal.aborted,false);
  });
  scheduler.start();await clock.advance(0);
  assert.equal(scheduler.status().scanInFlight,true);
  scheduler.signalLocalChange();scheduler.signalLocalChange();
  assert.equal(scheduler.status().localChangePending,true);
  assert.equal(clock.tasks.size,0);
  release();
  for(let i=0;i<9;i++)await Promise.resolve();
  assert.equal(scheduler.status().scanInFlight,false);
  await clock.advance(800);
  assert.deepEqual(calls,["startup","local-change"]);
  assert.equal(scheduler.status().localChangePending,false);
  scheduler.stop();
});

test("failed scan backs off without leaking messages, then resets after success",async()=>{
  const calls=[];
  const {clock,scheduler}=setup(async(_,why)=>{
    calls.push([clock.now,why]);
    if(calls.length<=2)throw Error("SECRET_JWT_MUST_NOT_LEAK");
  });
  scheduler.start();
  await clock.advance(0);
  assert.equal(scheduler.status().consecutiveFailures,1);
  assert.equal(scheduler.status().lastResult,"error");
  await clock.advance(4999);assert.equal(calls.length,1);
  await clock.advance(1);
  assert.deepEqual(calls[1],[5000,"retry"]);
  assert.equal(scheduler.status().consecutiveFailures,2);
  await clock.advance(9999);assert.equal(calls.length,2);
  await clock.advance(1);
  assert.deepEqual(calls[2],[15000,"retry"]);
  assert.equal(scheduler.status().lastResult,"success");
  assert.equal(scheduler.status().consecutiveFailures,0);
  assert.doesNotMatch(JSON.stringify(scheduler.status()),/SECRET_JWT/);
  scheduler.stop();
});

test("stop aborts a slow scan and prevents all queued retries or writes",async()=>{
  let capturedSignal;
  const calls=[];
  const {clock,scheduler}=setup(async(signal,why)=>{
    capturedSignal=signal;calls.push(why);
    await new Promise(resolve=>signal.addEventListener("abort",resolve,{once:true}));
  });
  scheduler.start();await clock.advance(0);
  scheduler.signalLocalChange();
  assert.equal(scheduler.status().scanInFlight,true);
  scheduler.stop();
  assert.equal(capturedSignal.aborted,true);
  for(let i=0;i<8;i++)await Promise.resolve();
  await clock.advance(360_000);
  assert.deepEqual(calls,["startup"]);
  assert.equal(clock.tasks.size,0);
  assert.equal(scheduler.status().started,false);
});

test("low-load cadence and trusted clock are validated",()=>{
  for(const opts of [
    {pollMs:0},{pollMs:59_999},{pollMs:600_001},
    {debounceMs:0},{debounceMs:249},{debounceMs:5001},
    {retryMs:0},{retryMs:999},{retryMs:60001},
  ])assert.throws(
    ()=>createObsidianAutoSyncWakeup({onCheck:async()=>{},...opts}),
    /low-load/,
  );
  assert.throws(()=>createObsidianAutoSyncWakeup({onCheck:null}),/scan/);
});
