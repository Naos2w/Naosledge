import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {link,mkdtemp,mkdir,rm,symlink,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {readObsidianLocalManifest} from "../lib/obsidian-local-manifest.ts";
import {planObsidianReconciliation} from "../lib/obsidian-sync-plan.ts";

const fingerprint=text=>createHash("sha256").update(Buffer.from(text,"utf8")).digest("hex");

async function withScratch(fn){
  const dir=await mkdtemp(path.join(tmpdir(),"naosledge-offline-sync-"));
  try{return await fn(dir);}
  finally{await rm(dir,{recursive:true,force:true});}
}

test("empty approved-style directory yields no remote reads or proposed writes",async()=>{
  await withScratch(async root=>{
    const result=await readObsidianLocalManifest(root);
    assert.deepEqual(result.fingerprints,[]);
    assert.equal(result.autoApplyAllowed,false);
    const plan=planObsidianReconciliation({
      local:result.fingerprints,remote:[],baseline:[],
    });
    assert.deepEqual(plan.decisions,[]);
    assert.equal(plan.autoApplyAllowed,false);
  });
});

test("direct synthetic Markdown is SHA-256 fingerprinted without exposing contents",async()=>{
  await withScratch(async root=>{
    const doc1="# Just my synthetic note\n[[other]]\n";
    const doc2="# Another synthetic note\n\nPassword: deliberately_fake_test_only";
    await writeFile(path.join(root,"alpha-note.md"),doc1);
    await writeFile(path.join(root,"beta-note.md"),doc2);
    const result=await readObsidianLocalManifest(root);
    assert.deepEqual(result.fingerprints,[
      {slug:"alpha-note",sha256:fingerprint(doc1)},
      {slug:"beta-note",sha256:fingerprint(doc2)},
    ]);
    assert.equal(result.autoApplyAllowed,false);
    assert.doesNotMatch(JSON.stringify(result),/deliberately_fake_test_only|Just my synthetic note/);
    assert.equal(await readFile(path.join(root,"alpha-note.md"),"utf8"),doc1);
  });
});

test("scanner never recurses into .obsidian or any unapproved directory",async()=>{
  await withScratch(async root=>{
    await mkdir(path.join(root,".obsidian"));
    await mkdir(path.join(root,"other-folder"));
    await writeFile(path.join(root,".obsidian","private-config.json"),'{"secret":"synthetic"}');
    await writeFile(path.join(root,"other-folder","hidden.md"),"synthetic out of scope");
    const result=await readObsidianLocalManifest(root);
    assert.deepEqual(result.fingerprints,[]);
    assert.equal(result.directoriesNotScanned,1);
    assert.equal(result.otherFiles,0);
  });
});

test("noncanonical Obsidian filenames are counted but never silently claimed synced",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,"My note.md"),"synthetic");
    await writeFile(path.join(root,"中文筆記.md"),"synthetic");
    await writeFile(path.join(root,"safe-note.md"),"synthetic");
    await writeFile(path.join(root,"image.png"),"synthetic");
    const result=await readObsidianLocalManifest(root);
    assert.deepEqual(result.fingerprints.map(n=>n.slug),["safe-note"]);
    assert.equal(result.unsupportedMarkdownFiles,2);
    assert.equal(result.otherFiles,1);
  });
});

test("local and synthetic remote versions reconcile to review-only decisions",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,"local-edited.md"),"v2");
    await writeFile(path.join(root,"remote-edited.md"),"v1");
    await writeFile(path.join(root,"both-edited.md"),"v2 local");
    const local=(await readObsidianLocalManifest(root)).fingerprints;
    const baseline=[
      {slug:"local-edited",sha256:fingerprint("v1")},
      {slug:"remote-edited",sha256:fingerprint("v1")},
      {slug:"both-edited",sha256:fingerprint("v1")},
    ];
    const remote=[
      {slug:"local-edited",sha256:fingerprint("v1"),revision:"test-rev-1"},
      {slug:"remote-edited",sha256:fingerprint("v2"),revision:"test-rev-2"},
      {slug:"both-edited",sha256:fingerprint("v2 remote"),revision:"test-rev-3"},
    ];
    const plan=planObsidianReconciliation({local,remote,baseline});
    assert.deepEqual(plan.decisions.map(x=>[x.slug,x.choice]),[
      ["both-edited","conflict"],
      ["local-edited","review-upload"],
      ["remote-edited","review-download"],
    ]);
    assert.equal(plan.autoApplyAllowed,false);
  });
});

test("oversized Markdown is rejected without reading its content into a report",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,"too-big.md"),"x".repeat(250001));
    await assert.rejects(readObsidianLocalManifest(root),/250KB/);
  });
});

test("reject invalid roots, including a file, relative path and missing directory",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,"some.md"),"note");
    await assert.rejects(readObsidianLocalManifest("relative/path"),/absolute/);
    await assert.rejects(readObsidianLocalManifest(path.join(root,"some.md")),/real directory/);
    await assert.rejects(readObsidianLocalManifest(path.join(root,"missing")),/ENOENT/);
  });
});

test("reject linked Markdown; never follow a note symlink out of an allowed folder",async t=>{
  await withScratch(async root=>{
    const real=path.join(root,"real-note.md");
    const shortcut=path.join(root,"shortcut.md");
    await writeFile(real,"synthetic");
    try{await symlink(real,shortcut,"file");}
    catch(error){
      if(["EPERM","EACCES","ENOSYS"].includes(error?.code)){t.skip("OS disallows test symlinks");return;}
      throw error;
    }
    await assert.rejects(readObsidianLocalManifest(root),/symlinks/);
  });
});

test("hardlinks are refused even without symlink privileges",async t=>{
  await withScratch(async root=>{
    const original=path.join(root,"original.md");
    const linked=path.join(root,"linked.md");
    await writeFile(original,"synthetic");
    try{await link(original,linked);}
    catch(error){
      if(["EPERM","EACCES","ENOSYS"].includes(error?.code)){
        t.skip("OS disallows test hardlinks");return;
      }
      throw error;
    }
    await assert.rejects(readObsidianLocalManifest(root),/hardlinked/);
  });
});

test("more than 500 Markdown entries fail closed",async()=>{
  await withScratch(async root=>{
    await Promise.all(Array.from({length:501},(_,i)=>
      writeFile(path.join(root,`note-${String(i).padStart(3,"0")}.md`),"test")));
    await assert.rejects(readObsidianLocalManifest(root),/500 Markdown/);
  });
});


test("only exact real .obsidian config is excluded, without reading its Markdown",async()=>{
  await withScratch(async root=>{
    await mkdir(path.join(root,".obsidian"));
    await writeFile(path.join(root,".obsidian","config-note.md"),"x".repeat(250001));
    assert.deepEqual(await readObsidianLocalManifest(root),{
      fingerprints:[],unsupportedMarkdownFiles:0,otherFiles:0,
      directoriesNotScanned:0,autoApplyAllowed:false,
    });
    for(const name of [".obsidian-extra","nested-notes"]){
      await mkdir(path.join(root,name));
      await writeFile(path.join(root,name,"nested-notes.md"),"synthetic unscanned note");
    }
    assert.equal((await readObsidianLocalManifest(root)).directoriesNotScanned,2);
  });
});

test("a regular file called .obsidian is not exempted as config",async()=>{
  await withScratch(async root=>{
    await writeFile(path.join(root,".obsidian"),"synthetic file");
    assert.equal((await readObsidianLocalManifest(root)).otherFiles,1);
  });
});

for(const name of [".obsidian","nested-notes"]){
  test(`directory link ${name} is never ignored as safe config`,async t=>{
    await withScratch(async root=>{
      await withScratch(async target=>{
        await writeFile(path.join(target,"nested-notes.md"),"synthetic link target");
        try{await symlink(target,path.join(root,name),process.platform==="win32"?"junction":"dir");}
        catch(error){
          if(["EPERM","EACCES","ENOSYS"].includes(error?.code)){t.skip("OS disallows directory links");return;}
          throw error;
        }
        if(name===".obsidian"){
          await assert.rejects(readObsidianLocalManifest(root),/link or redirect/);
        }else{
          // A junction to Markdown outside the Vault must not make coverage
          // look complete merely by counting it as an unrelated file.
          await assert.rejects(readObsidianLocalManifest(root),/symlinks or junctions/);
        }
      });
    });
  });
}


test("differently cased config name is not the exact standard directory",async()=>{
  await withScratch(async root=>{
    await mkdir(path.join(root,".Obsidian"));
    assert.equal((await readObsidianLocalManifest(root)).directoriesNotScanned,1);
  });
});
