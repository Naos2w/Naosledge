import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm,symlink,writeFile,mkdir}
  from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createM8SyncPreferenceStore}
  from "../lib/obsidian-m8-sync-preferences.ts";
import {createM8WindowsReadOnlyAgent}
  from "../lib/obsidian-m8-windows-agent-controller.ts";

const FILE="sync-preferences.v1.json";
async function scratch(run){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m8-preferences-test-"));
  try{return await run(root);}
  finally{await rm(root,{recursive:true,force:true});}
}
const valid={version:1,enabled:true,intent:"running"};

test("missing preferences default to disabled and stopped",()=>scratch(async root=>{
  const store=createM8SyncPreferenceStore({testOnlyRoot:root});
  assert.deepEqual(await store.load(),{
    version:1,enabled:false,intent:"stopped",
  });
  await assert.rejects(readFile(path.join(root,FILE)),{code:"ENOENT"});
}));

test("a new reader restores a strict versioned preference",()=>scratch(async root=>{
  await createM8SyncPreferenceStore({testOnlyRoot:root}).save(valid);
  assert.deepEqual(
    await createM8SyncPreferenceStore({testOnlyRoot:root}).load(),valid);
  assert.equal(await readFile(path.join(root,FILE),"utf8"),JSON.stringify(valid));
}));

test("unsupported, corrupt, extra, missing and partial files are rejected without rewrite",async t=>{
  const cases=[
    ["unsupported",{...valid,version:2}],
    ["corrupt",'{"version":1'],
    ["extra",{...valid,jwt:"secret"}],
    ["missing",{version:1,enabled:true}],
    ["non-canonical",'{ "version":1,"enabled":true,"intent":"running" }'],
  ];
  for(const [name,value] of cases)await t.test(name,()=>scratch(async root=>{
    const raw=typeof value==="string"?value:JSON.stringify(value);
    const filename=path.join(root,FILE);
    await writeFile(filename,raw,{mode:0o600});
    await assert.rejects(createM8SyncPreferenceStore({testOnlyRoot:root}).load(),
      /preferences unavailable/);
    assert.equal(await readFile(filename,"utf8"),raw);
  }));
});

test("unsafe paths and symlink roots or files are rejected",async t=>{
  await t.test("arbitrary TEMP child",async()=>{
    const root=await mkdtemp(path.join(tmpdir(),"unsafe-m8-"));
    try{await assert.rejects(
      createM8SyncPreferenceStore({testOnlyRoot:root}).load(),
      /preferences unavailable/);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  await t.test("nested path",()=>scratch(async root=>{
    const nested=path.join(root,"nested");
    await mkdir(nested);
    await assert.rejects(
      createM8SyncPreferenceStore({testOnlyRoot:nested}).load(),
      /preferences unavailable/);
  }));
  await t.test("symlink root",async()=>{
    const target=await mkdtemp(path.join(tmpdir(),"naosledge-m8-preferences-test-"));
    const link=path.join(tmpdir(),`naosledge-m8-preferences-test-link-${process.pid}`);
    try{
      await symlink(target,link,"dir");
      await assert.rejects(
        createM8SyncPreferenceStore({testOnlyRoot:link}).load(),
        /preferences unavailable/);
    }finally{
      await rm(link,{force:true});
      await rm(target,{recursive:true,force:true});
    }
  });
  await t.test("symlink preference file",()=>scratch(async root=>{
    const target=path.join(root,"target.json");
    await writeFile(target,JSON.stringify(valid));
    await symlink(target,path.join(root,FILE));
    await assert.rejects(
      createM8SyncPreferenceStore({testOnlyRoot:root}).load(),
      /preferences unavailable/);
  }));
});

test("controlled pre-commit failure preserves the prior valid value",()=>scratch(async root=>{
  const first={version:1,enabled:false,intent:"paused"};
  await createM8SyncPreferenceStore({testOnlyRoot:root}).save(first);
  const failing=createM8SyncPreferenceStore({
    testOnlyRoot:root,
    testOnlyBeforeCommit:async()=>{throw Error("synthetic write failure");},
  });
  await assert.rejects(failing.save(valid),/preferences unavailable/);
  assert.deepEqual(await createM8SyncPreferenceStore({testOnlyRoot:root}).load(),first);
}));

test("persisted stop, pause or running intent never auto-starts and leaks no private data",async()=>{
  const prefRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m8-preferences-test-"));
  const agentRoot=await mkdtemp(path.join(tmpdir(),"naosledge-m8-agent-test-"));
  const secrets=["header.payload.signature","00000000-0000-4000-8000-000000000041",
    "private note body","C:\\PrivateVault"];
  try{
    const preferences=createM8SyncPreferenceStore({testOnlyRoot:prefRoot});
    let lastAgent;
    for(const intent of ["stopped","paused","running"]){
      const stored={version:1,enabled:true,intent};
      await preferences.save(stored);
      const agent=createM8WindowsReadOnlyAgent({
        requestFreshJwt:async()=>{throw Error("must not request a token");},
        preferences,
        testOnly:{
          root:agentRoot,fetcher:async()=>{throw Error("must not fetch");},
          journal:{testRoot:agentRoot,testProtector:{seal:async x=>x,unseal:async x=>x},
            testReadLocal:async()=>{throw Error("must not read notes");}},
        },
      });
      assert.deepEqual(await agent.loadPreferences(),stored);
      assert.equal(agent.status().state,"stopped");
      assert.equal(agent.status().automaticTransfersEnabled,false);
      lastAgent=agent;
    }
    const output=JSON.stringify({stored:await preferences.load(),status:lastAgent.status()});
    for(const secret of secrets)assert.equal(output.includes(secret),false);
    const disk=await readFile(path.join(prefRoot,FILE),"utf8");
    for(const secret of secrets)assert.equal(disk.includes(secret),false);
  }finally{
    await rm(prefRoot,{recursive:true,force:true});
    await rm(agentRoot,{recursive:true,force:true});
  }
});

test("preference schema cannot persist credentials, owners, notes or Vault lists",()=>scratch(async root=>{
  const store=createM8SyncPreferenceStore({testOnlyRoot:root});
  for(const extra of ["jwt","ownerUuid","noteContent","vaults"]){
    await assert.rejects(store.save({...valid,[extra]:"private"}),
      /preferences unavailable/);
  }
  await assert.rejects(readFile(path.join(root,FILE)),{code:"ENOENT"});
}));
