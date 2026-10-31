import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,readdir,rm,unlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {
  adoptProductionM8EqualPairing,setM9SignedAutomaticMode,
  inspectProductionM8Baseline,
} from "../lib/obsidian-m8-production-baseline-journal.ts";
import {runM9SignedAutoCycle}
  from "../lib/obsidian-m9-signed-auto-cycle.ts";
import {serializeObsidianMarkdown}
  from "../lib/obsidian-markdown.ts";
import {readObsidianLocalManifest}
  from "../lib/obsidian-local-manifest.ts";
import {RELEASE_DATA_API_URL,RELEASE_NEON_BRANCH}
  from "../lib/neon/production-release.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000082";
const JWT=(sub=OWNER,offset=3600)=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+offset}))
    .toString("base64url")+".signedfake";
const protector={seal:async k=>k.toString("base64"),
  unseal:async b=>Buffer.from(b,"base64")};
const row=(slug,part="v1",revision="2026-10-31T04:00:00.000Z")=>({
  id:"00000000-0000-4000-8000-"+(slug==="first"?"000000000051":
    slug==="second"?"000000000052":"000000000053"),
  slug,title:"Test "+slug,summary:"isolated synthetic",
  content_md:"# "+part+"\n\n[["+part+"-link]]",
  category:"test",tags:[],learned_on:"2026-10-31",
  updated_at:revision,
});
const markdown=note=>serializeObsidianMarkdown({
  title:note.title,slug:note.slug,excerpt:note.summary,
  content_md:note.content_md,category:note.category,tags:note.tags,
  learned_on:note.learned_on,
});
const respond=(data,range,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json",
    ...(range?{"content-range":range}:{})},
});
function server(initial=[]){
  let rows=initial.map(x=>({...x}));
  let links=new Map(rows.map(x=>[x.slug,
    [x.content_md.includes("v1")?"v1-link":
      x.content_md.includes("v2")?"v2-link":"v3-link"]]));
  let posts=0,loss=false,changed=false;
  const fetcher=async(uri,req)=>{
    const url=new URL(uri);
    assert.equal(url.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(req.redirect,"manual");
    assert.equal(req.credentials,"omit");
    const provided=req.headers.Authorization;
    assert.match(provided,/^Bearer /);
    const sub=JSON.parse(Buffer.from(provided.slice(7).split(".")[1],
      "base64url").toString("utf8")).sub;
    if(req.method==="GET"){
      if(url.pathname.endsWith("/blog_admins")){
        const ok=sub===OWNER;
        return respond(ok?[{user_id:OWNER}]:[],ok?"0-0/1":"*/0");
      }
      if(url.pathname.endsWith("/knowledge_notes")){
        const candidates=url.searchParams.has("slug")?
          rows.filter(x=>x.slug===url.searchParams.get("slug").slice(3)):rows;
        const offset=Number(url.searchParams.get("offset")||0);
        const output=candidates.slice(offset,offset+20);
        return respond(output,output.length?
          offset+"-"+(offset+output.length-1)+"/"+candidates.length:"*/0");
      }
      if(url.pathname.endsWith("/knowledge_links")){
        const note=rows.find(x=>x.id===url.searchParams.get("source_note_id")?.slice(3));
        const keys=links.get(note?.slug)||[];
        return respond(keys.map(target_key=>({target_key})),
          keys.length?"0-"+(keys.length-1)+"/"+keys.length:"*/0");
      }
      throw Error("fake endpoint not allowed");
    }
    assert.equal(req.method,"POST");
    if(sub!==OWNER)throw Error("Unauthorized test write");
    posts++;
    const body=JSON.parse(req.body);
    if(url.pathname.endsWith("/rpc/save_knowledge_note")){
      assert.equal(body.p_id,null);
      if(rows.some(x=>x.slug===body.p_slug))
        return respond({code:"23505"},null,409);
      const r=row(body.p_slug,body.p_content_md.startsWith("#")?
        body.p_content_md.split("\n")[0].slice(2):"created",
        "2026-10-31T05:00:00.000Z");
      rows.push({
        ...r,title:body.p_title,summary:body.p_summary,
        content_md:body.p_content_md,category:body.p_category,
        tags:body.p_tags,learned_on:body.p_learned_on,
      });
      links.set(body.p_slug,[...body.p_links]);
      if(loss)throw Error("LOST_POST_RESPONSE");
      return respond(r.id,null);
    }
    if(url.pathname.endsWith("/rpc/update_knowledge_note_cas_with_links")){
      const found=rows.find(x=>x.id===body.p_id);
      if(!found||found.updated_at!==body.p_expected_updated_at||
         JSON.stringify(links.get(found.slug)||[])!==
           JSON.stringify(body.p_expected_links))
        return respond({code:"40001"},null,409);
      Object.assign(found,{
        title:body.p_title,summary:body.p_summary,
        content_md:body.p_content_md,category:body.p_category,
        tags:body.p_tags,learned_on:body.p_learned_on,
        updated_at:"2026-10-31T06:00:00.000Z",
      });
      links.set(found.slug,[...body.p_links]);
      if(loss)throw Error("LOST_POST_RESPONSE");
      return respond(found.id,null);
    }
    throw Error("Unexpected Production mutating endpoint in fake server");
  };
  return {fetcher,get posts(){return posts},get rows(){return rows},
    setRows:next=>{rows=next.map(x=>({...x}))
      .sort((a,b)=>a.slug.localeCompare(b.slug,"en"));links=new Map(
      rows.map(x=>[x.slug,[x.content_md.includes("v1")?"v1-link":
        x.content_md.includes("v2")?"v2-link":"v3-link"]])
    );},
    dropResponse:()=>{loss=true;},
  };
}
async function fixture(initial,fn){
  const vault=await mkdtemp(path.join(tmpdir(),"naosledge-m8-vault-test-"));
  const pending=await mkdtemp(path.join(tmpdir(),"naosledge-m8-incoming-test-"));
  const archive=await mkdtemp(path.join(tmpdir(),"naosledge-m8-backups-test-"));
  const journal=await mkdtemp(path.join(tmpdir(),
    "naosledge-m8-production-baseline-test-"));
  const opts={
    testRoot:journal,testProtector:protector,
    testReadLocal:()=>readObsidianLocalManifest(vault),
  };
  try{
    const remote=server(initial);
    for(const n of initial){
      await writeFile(path.join(vault,n.slug+".md"),markdown(n));
    }
    await adoptProductionM8EqualPairing({
      ownerJwt:JWT(),fetcher:remote.fetcher,options:opts,
      typedConfirmation:"APPROVE M8 PRODUCTION INITIAL EQUALITY",
    });
    await setM9SignedAutomaticMode({
      ownerJwt:JWT(),fetcher:remote.fetcher,options:opts,
      testIncomingRoot:pending,schemaReady:true,
      enabled:true,typedConfirmation:"ENABLE M9 PRODUCTION AUTO SYNC",
    });
    const params={
      ownerJwt:JWT(),schemaReady:true,fetcher:remote.fetcher,
      testOnly:{vaultRoot:vault,privateRoot:pending,
        archiveRoot:archive,journalOptions:opts},
    };
    return await fn({vault,pending,archive,journal,opts,remote,params});
  }finally{
    await rm(vault,{recursive:true,force:true});
    await rm(pending,{recursive:true,force:true});
    await rm(archive,{recursive:true,force:true});
    await rm(journal,{recursive:true,force:true});
  }
}
const check=(f)=>inspectProductionM8Baseline({
  ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.opts,
});

test("signed M9 auto upload-create writes one new note and a durable HMAC checkpoint",async()=>{
  await fixture([],async f=>{
    await writeFile(path.join(f.vault,"first.md"),markdown(row("first","created")));
    const result=await runM9SignedAutoCycle(f.params);
    assert.equal(result.status,"transferred");
    assert.equal(result.action,"upload-create");
    assert.equal(result.transferCount,1);
    assert.equal(result.baselineCommitVerified,true);
    assert.equal(f.remote.posts,1);
    assert.equal((await check(f)).recordCount,3);
    const idle=await runM9SignedAutoCycle(f.params);
    assert.equal(idle.status,"idle");
    assert.equal(idle.transferCount,0);
    assert.equal(f.remote.posts,1,"No duplicate upload");
  });
});

test("signed M9 auto upload-cas checks WikiLink CAS and signs new remote version",async()=>{
  await fixture([row("first")],async f=>{
    await writeFile(path.join(f.vault,"first.md"),markdown(row("first","v2")));
    const result=await runM9SignedAutoCycle(f.params);
    assert.equal(result.action,"upload-cas");
    assert.equal(result.baselineCommitVerified,true);
    assert.equal(f.remote.posts,1);
    assert.match(f.remote.rows[0].content_md,/v2-link/);
    assert.equal((await check(f)).recordCount,3);
    assert.equal((await runM9SignedAutoCycle(f.params)).status,"idle");
  });
});

test("signed M9 auto download-new creates safely, journals and clears approved durable intent",async()=>{
  await fixture([],async f=>{
    f.remote.setRows([row("first")]);
    const r=await runM9SignedAutoCycle(f.params);
    assert.equal(r.action,"download-new");
    assert.equal(r.transferCount,1);
    assert.equal(r.baselineCommitVerified,true);
    assert.equal(await readFile(path.join(f.vault,"first.md"),"utf8"),
      markdown(row("first")));
    assert.deepEqual(await readdir(f.pending),[]);
    assert.equal((await check(f)).recordCount,3);
    assert.equal(f.remote.posts,0);
  });
});

test("signed M9 auto download-replace preserves original in archive and checkpoint",async()=>{
  await fixture([row("first")],async f=>{
    const original=await readFile(path.join(f.vault,"first.md"),"utf8");
    f.remote.setRows([row("first","v2","2026-10-31T05:00:00.000Z")]);
    const r=await runM9SignedAutoCycle(f.params);
    assert.equal(r.action,"download-replace");
    assert.equal(r.baselineCommitVerified,true);
    assert.equal((await check(f)).recordCount,3);
    assert.equal(await readFile(path.join(f.vault,"first.md"),"utf8"),
      markdown(row("first","v2","2026-10-31T05:00:00.000Z")));
    assert.deepEqual(await readdir(f.pending),[]);
    const folder=(await readdir(f.archive))[0];
    assert.ok(folder?.startsWith("op-"));
    const backup=await readFile(path.join(f.archive,folder,
      "first.md.bak"),"utf8");
    assert.equal(backup,original);
    assert.equal(f.remote.posts,0);
  });
});

test("two remote notes process one-per-cycle in a stable order",async()=>{
  await fixture([],async f=>{
    f.remote.setRows([row("second"),row("first")]);
    const a=await runM9SignedAutoCycle(f.params);
    assert.equal(a.action,"download-new");
    assert.equal(a.transferCount,1);
    assert.equal((await check(f)).recordCount,3);
    const b=await runM9SignedAutoCycle(f.params);
    assert.equal(b.transferCount,1);
    assert.equal((await check(f)).recordCount,4);
    const c=await runM9SignedAutoCycle(f.params);
    assert.equal(c.status,"idle");
    assert.equal(f.remote.posts,0);
  });
});

test("two-sided conflict and a deletion are manual-only; no automatic uploads",async()=>{
  await fixture([row("first")],async f=>{
    await writeFile(path.join(f.vault,"first.md"),markdown(row("first","v2")));
    f.remote.setRows([row("first","v3","2026-10-31T05:00:00.000Z")]);
    const r=await runM9SignedAutoCycle(f.params);
    assert.equal(r.status,"manual-review");
    assert.equal(r.transferCount,0);
    assert.equal(f.remote.posts,0);
    await unlink(path.join(f.vault,"first.md"));
    const d=await runM9SignedAutoCycle(f.params);
    assert.equal(d.status,"manual-review");
    assert.equal(d.transferCount,0);
    assert.equal((await check(f)).recordCount,2);
  });
});

test("disabling signed mode and schema false block writes even after local modifications",async()=>{
  await fixture([row("first")],async f=>{
    await writeFile(path.join(f.vault,"first.md"),markdown(row("first","v2")));
    const pre=await runM9SignedAutoCycle({...f.params,schemaReady:false});
    assert.equal(pre.status,"schema-not-ready");
    await setM9SignedAutomaticMode({
      ownerJwt:JWT(),fetcher:f.remote.fetcher,options:f.opts,
      schemaReady:true,enabled:false,
      typedConfirmation:"DISABLE M9 PRODUCTION AUTO SYNC",
    });
    const off=await runM9SignedAutoCycle(f.params);
    assert.equal(off.status,"disabled");
    assert.equal(f.remote.posts,0);
  });
});

test("invalid token, changed Owner and pending intent are always fail-closed",async()=>{
  await fixture([row("first")],async f=>{
    await writeFile(path.join(f.vault,"first.md"),markdown(row("first","v2")));
    await assert.rejects(runM9SignedAutoCycle({
      ...f.params,ownerJwt:JWT(OTHER),
    }));
    await writeFile(path.join(f.pending,"unresolved.txt"),"do not delete");
    await assert.rejects(runM9SignedAutoCycle(f.params));
    assert.equal(await readFile(path.join(f.pending,"unresolved.txt"),"utf8"),
      "do not delete");
    assert.equal(f.remote.posts,0);
  });
});

test("lost CAS response yields manual checkpoint recovery on NEXT scan, not duplicate POST",async()=>{
  await fixture([row("first")],async f=>{
    await writeFile(path.join(f.vault,"first.md"),markdown(row("first","v2")));
    f.remote.dropResponse();
    await assert.rejects(runM9SignedAutoCycle(f.params),/no automatic retry/);
    assert.equal(f.remote.posts,1);
    const next=await runM9SignedAutoCycle(f.params);
    assert.equal(next.status,"manual-review");
    assert.equal(next.transferCount,0);
    assert.equal(f.remote.posts,1);
    assert.equal((await check(f)).recordCount,2);
  });
});
