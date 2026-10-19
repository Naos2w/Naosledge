import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {inspectObsidianRegistration} from "../lib/obsidian-vault-registration.ts";

async function withRegistration(fn){
  const dir=await mkdtemp(path.join(tmpdir(),"naosledge-obsidian-registration-"));
  const vault=path.join(dir,"Naosledge");
  const registry=path.join(dir,"obsidian.json");
  try{
    await mkdir(vault);
    return await fn({dir,vault,registry});
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
}

async function writeRegistry(registry,vaults){
  await writeFile(registry,JSON.stringify({vaults}),"utf8");
}
async function initialiseSettings(vault){
  const config=path.join(vault,".obsidian");
  await mkdir(config);
  await writeFile(path.join(config,"app.json"),"{}","utf8");
}

test("Obsidian GUI registration and matching .obsidian config are confirmed read-only",async()=>{
  await withRegistration(async({vault,registry})=>{
    await initialiseSettings(vault);
    await writeRegistry(registry,{
      a:{path:vault,ts:1792340000000,open:true},
      other:{path:path.join(vault,"another-vault"),open:false},
    });
    const result=await inspectObsidianRegistration({vaultPath:vault,registryPath:registry});
    assert.deepEqual(result,{
      registered:true,configPresent:true,appConfigPresent:true,
      matchedRegistrations:1,autoSyncEnabled:false,
    });
    assert.doesNotMatch(JSON.stringify(result),/obsidian-registration|another-vault|path|secret/i);
  });
});

test("bare folder without Obsidian GUI or registry is not accepted",async()=>{
  await withRegistration(async({vault,registry})=>{
    assert.deepEqual(await inspectObsidianRegistration({vaultPath:vault,registryPath:registry}),{
      registered:false,configPresent:false,appConfigPresent:false,
      matchedRegistrations:0,autoSyncEnabled:false,
    });
  });
});

test("settings alone do not prove that the vault is in the global Obsidian registry",async()=>{
  await withRegistration(async({vault,registry})=>{
    await initialiseSettings(vault);
    await writeRegistry(registry,{other:{path:path.join(vault,"Naosledge")}});
    const result=await inspectObsidianRegistration({vaultPath:vault,registryPath:registry});
    assert.equal(result.registered,false);
    assert.equal(result.configPresent,true);
    assert.equal(result.matchedRegistrations,0);
  });
});

test("global registration alone without app.json is not accepted",async()=>{
  await withRegistration(async({vault,registry})=>{
    await mkdir(path.join(vault,".obsidian"));
    await writeRegistry(registry,{owner:{path:vault}});
    const result=await inspectObsidianRegistration({vaultPath:vault,registryPath:registry});
    assert.equal(result.registered,false);
    assert.equal(result.appConfigPresent,false);
  });
});

test("duplicate registrations require manual review, no automatic trust",async()=>{
  await withRegistration(async({vault,registry})=>{
    await initialiseSettings(vault);
    await writeRegistry(registry,{a:{path:vault},b:{path:vault.toUpperCase()}});
    const result=await inspectObsidianRegistration({vaultPath:vault,registryPath:registry});
    assert.equal(result.registered,false);
    assert.equal(result.matchedRegistrations,2);
  });
});

test("invalid or oversized registry fails closed without leaking its contents",async()=>{
  await withRegistration(async({vault,registry})=>{
    await initialiseSettings(vault);
    await writeFile(registry,"This is not valid JSON: fake secret");
    await assert.rejects(inspectObsidianRegistration({
      vaultPath:vault,registryPath:registry,
    }),error=>{
      assert.match(error.message,/Invalid or changed Obsidian Vault registry/);
      assert.doesNotMatch(error.message,/fake secret/);
      return true;
    });
    await writeFile(registry,"x".repeat(256001));
    await assert.rejects(inspectObsidianRegistration({
      vaultPath:vault,registryPath:registry,
    }),/size limit/);
  });
});

test("relative paths, missing Vault or invalid registry schema are rejected",async()=>{
  await withRegistration(async({vault,registry})=>{
    await assert.rejects(inspectObsidianRegistration({
      vaultPath:"relative-path",registryPath:registry,
    }),/absolute/);
    await assert.rejects(inspectObsidianRegistration({
      vaultPath:path.join(vault,"missing"),registryPath:registry,
    }),/root missing/);
    await initialiseSettings(vault);
    await writeRegistry(registry,[]);
    await assert.rejects(inspectObsidianRegistration({
      vaultPath:vault,registryPath:registry,
    }),/Invalid Obsidian/);
  });
});
