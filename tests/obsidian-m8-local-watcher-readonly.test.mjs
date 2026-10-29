import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createObsidianRootReadOnlyWatcher}
  from "../lib/obsidian-m8-local-watcher-readonly.ts";

async function withRoot(run){
  const folder=await mkdtemp(path.join(tmpdir(),"naosledge-m8-watcher-"));
  try{return await run(folder);}finally{await rm(folder,{recursive:true,force:true});}
}
class FakeWatcher extends EventEmitter{
  closed=false;
  close(){this.closed=true;}
}
function fakeSetup(root,callbacks={}){
  let signalChange;
  const instance=new FakeWatcher();
  const watcher=createObsidianRootReadOnlyWatcher({
    root,
    onLocalChange:callbacks.onLocalChange??(()=>{}),
    onError:callbacks.onError,
    signal:callbacks.signal,
    watcherFactory:(_folder,notify)=>{
      signalChange=notify;
      return instance;
    },
  });
  return {watcher,instance,notify:(...parts)=>signalChange(...parts)};
}

test("watcher import is inert; explicit start observes only a real OS-temp directory",async()=>{
  await withRoot(async root=>{
    let changes=0;
    const {watcher,instance,notify}=fakeSetup(root,{
      onLocalChange:()=>{changes++;},
    });
    assert.deepEqual(watcher.status(),{started:false,requests:0});
    await watcher.start();await watcher.start();
    assert.equal(watcher.status().started,true);
    assert.equal(instance.closed,false);
    notify("change","note.md");
    notify("rename","note.md");
    notify("rename",null);
    notify("change",Buffer.from("unsafe-name","utf8"));
    notify("unexpected-event",null);
    assert.equal(changes,4);
    assert.equal(watcher.status().requests,4);
    watcher.stop();watcher.stop();
    assert.equal(instance.closed,true);
    notify("rename","anything");
    assert.equal(changes,4);
    assert.equal(watcher.status().started,false);
  });
});

test("watcher errors fail closed and stop observing the folder",async()=>{
  await withRoot(async root=>{
    let errors=0,changes=0;
    const {watcher,instance,notify}=fakeSetup(root,{
      onLocalChange:()=>{changes++;},
      onError:()=>{errors++;},
    });
    await watcher.start();
    instance.emit("error",new Error("PRIVATE_PATH_NOT_TO_LOG"));
    assert.equal(errors,1);
    assert.equal(watcher.status().started,false);
    assert.equal(instance.closed,true);
    notify("change","secret.md");
    assert.equal(changes,0);
  });
});

test("callback exceptions stop observing without leaking a filename or source exception",async()=>{
  await withRoot(async root=>{
    let errors=0;
    const {watcher,instance,notify}=fakeSetup(root,{
      onLocalChange:()=>{throw Error("PRIVATE_NOTE_TITLE");},
      onError:()=>{errors++;},
    });
    await watcher.start();
    assert.doesNotThrow(()=>notify("change","private-title.md"));
    assert.equal(errors,1);
    assert.equal(instance.closed,true);
    assert.equal(watcher.status().started,false);
  });
});

test("explicit abort stops a watcher and prevents later notifications",async()=>{
  await withRoot(async root=>{
    const controller=new AbortController();
    let changes=0;
    const {watcher,instance,notify}=fakeSetup(root,{
      signal:controller.signal,onLocalChange:()=>{changes++;},
    });
    await watcher.start();
    controller.abort();
    assert.equal(watcher.status().started,false);
    assert.equal(instance.closed,true);
    notify("rename",null);
    assert.equal(changes,0);
  });
});

test("missing or relative roots are refused before creating watchers",async()=>{
  assert.throws(()=>createObsidianRootReadOnlyWatcher({
    root:"../../real-vault",onLocalChange:()=>{},
  }),/absolute approved root/);
  await assert.rejects(createObsidianRootReadOnlyWatcher({
    root:path.join(tmpdir(),"m8-absent-watcher-0000"),
    onLocalChange:()=>{},
  }).start());
});

test("real fs.watch receives OS events on disposable files without touching the real Vault",async()=>{
  await withRoot(async root=>{
    let eventSeen;
    const seen=new Promise(resolve=>{eventSeen=resolve;});
    let count=0;
    const watcher=createObsidianRootReadOnlyWatcher({
      root,onLocalChange:()=>{
        count++;
        eventSeen();
      },
    });
    await watcher.start();
    try{
      const timeout=setTimeout(()=>eventSeen("timeout"),5000);
      try{
        await writeFile(path.join(root,"synthetic-note.md"),"# disposable\n");
        const status=await seen.then(()=>count>0?"received":"timeout");
        assert.equal(status,"received","filesystem event was not emitted");
        assert.ok(watcher.status().requests>=1);
      }finally{clearTimeout(timeout);}
    }finally{watcher.stop();}
    assert.equal(watcher.status().started,false);
  });
});

test("read-only watcher never provides file contents, deletes or HTTP calls",async()=>{
  const src=await import("node:fs/promises").then(fs=>fs.readFile(
    new URL("../lib/obsidian-m8-local-watcher-readonly.ts",import.meta.url),"utf8"));
  assert.doesNotMatch(src,/writeFile\(|readFile\(|rename\(|unlink\(|rm\(|fetch\(|setInterval\(|\.rpc\(/);
});
