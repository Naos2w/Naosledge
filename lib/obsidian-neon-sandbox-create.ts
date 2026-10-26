/**
 * M3 create-only Neon INTEGRATION SANDBOX transport.
 *
 * A low-level transport for a FUTURE MSI per-note manual approval flow; not a
 * CLI, web action, background sync, or permission to read the real Vault.
 * This module never updates, upserts, deletes, or persists a Baseline.
 * Calling code must collect a fresh, note-specific typed confirmation rather
 * than reusing an M2 UI selection as write approval.
 */
import {createHash} from "node:crypto";
import {parseObsidianMarkdown,serializeObsidianMarkdown}
  from "./obsidian-markdown.ts";
import {extractWikiReferences} from "./wiki-links.ts";
import {
  NEON_SYNC_SANDBOX_BRANCH,NEON_SYNC_SANDBOX_DATA_API,
  fetchVerifiedNeonSandboxOwnerFingerprints,fetchNeonSandboxFingerprints,
} from "./obsidian-neon-sandbox-readonly.ts";
import type {SyncDecision} from "./obsidian-sync-plan.ts";

type Fetcher=typeof fetch;
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MARKDOWN_BYTES=250_000;

export async function createNeonSandboxNoteOnly(args:{
  branchId:string;
  sandboxOwnerJwt:string;
  /** M1's inspected decision, never an executable M2 UI selection. */
  decision:SyncDecision;
  /** Re-read the approved note immediately before POST; never reuse M1's cached Markdown. */
  readMarkdown:()=>Promise<string>;
  /** Must be typed for this exact note by a future approved caller. */
  typedConfirmation:string;
  fetcher?:Fetcher;
}):Promise<{slug:string;sha256:string;revision:string;baselineSaved:false}>{
  if(!args||args.branchId!==NEON_SYNC_SANDBOX_BRANCH||
     typeof args.readMarkdown!=="function"){
    throw Error("M3 requires one bounded note for the approved Sandbox");
  }
  const d=args.decision;
  if(!d||d.choice!=="review-missing-remote"||d.manualReview!==true||
     d.expectedRemoteSha!==null||d.expectedRemoteRevision!==null||
     typeof d.expectedLocalSha!=="string"||!SHA.test(d.expectedLocalSha)||
     args.typedConfirmation!=="CREATE SANDBOX "+d.slug){
    throw Error("M3 requires a fresh per-note create-only confirmation");
  }
  // Independent Owner-RLS proof first: 200 + [] alone does not prove ownership.
  const request=args.fetcher??fetch;
  const before=await fetchVerifiedNeonSandboxOwnerFingerprints({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
  });
  if(before.numberOfNotes>=20||before.fingerprints.some(n=>n.slug===d.slug)){
    throw Error("M3 create stopped: remote note exists or full inventory reached its limit");
  }

  // An M1 snapshot may be stale after the Owner GET. Read the source again
  // only now, immediately before insertion, and refuse changed bytes.
  const markdown=await args.readMarkdown();
  if(typeof markdown!=="string"||Buffer.byteLength(markdown,"utf8")>MAX_MARKDOWN_BYTES){
    throw Error("M3 requires one bounded note for the approved Sandbox");
  }
  const parsed=parseObsidianMarkdown(markdown,d.slug+".md","1970-01-01");
  if(!parsed||parsed.metadata.slug!==d.slug||
     serializeObsidianMarkdown({...parsed.metadata,content_md:parsed.content_md})!==markdown||
     createHash("sha256").update(markdown,"utf8").digest("hex")!==d.expectedLocalSha){
    throw Error("M3 Markdown is not the exact reviewed portable note");
  }
  // A plain INSERT has no backlink maintenance. Notes containing WikiLinks
  // use the EXISTING owner-RLS SECURITY INVOKER RPC instead: with p_id=null
  // it creates only, and the note + link index commit in a single transaction.
  // Never invoke its existing-note UPDATE mode from this create-only entry.
  const wikiKeys=extractWikiReferences(parsed.content_md);
  if(wikiKeys.length>80){
    throw Error("M3 Sandbox create exceeds the atomic WikiLink limit");
  }
  const linked=wikiKeys.length>0;

  // Both routes are fixed to the Neon Integration Sandbox and insert-only:
  // the unique owner/slug constraint prevents a concurrent duplicate.
  const endpoint=new URL(NEON_SYNC_SANDBOX_DATA_API);
  const url=new URL(endpoint.href.replace(/\/$/,"")+
    (linked?"/rpc/save_knowledge_note":"/knowledge_notes"));
  if(!linked)url.searchParams.set("select","id,slug");
  const result=await request(url.href,{
    method:"POST",redirect:"manual",credentials:"omit",cache:"no-store",
    headers:{
      Authorization:"Bearer "+args.sandboxOwnerJwt,
      Accept:"application/json","Content-Type":"application/json",
      "Cache-Control":"no-store",Prefer:"return=representation",
    },
    body:JSON.stringify(linked?{
      // The existing PostgREST RPC is SECURITY INVOKER, uses Owner JWT/RLS,
      // and inserts note plus all outgoing links within ONE SQL transaction.
      p_id:null,p_slug:d.slug,p_title:parsed.metadata.title,
      p_summary:parsed.metadata.excerpt,p_content_md:parsed.content_md,
      p_category:parsed.metadata.category,p_tags:parsed.metadata.tags,
      p_learned_on:parsed.metadata.learned_on,p_links:wikiKeys,
    }:{
      slug:d.slug,title:parsed.metadata.title,
      summary:parsed.metadata.excerpt,content_md:parsed.content_md,
      category:parsed.metadata.category,tags:parsed.metadata.tags,
      learned_on:parsed.metadata.learned_on,
    }),
    signal:AbortSignal.timeout(16000),
  });
  // Never log remote error bodies, JWTs, Markdown or private note identifiers.
  // For a scalar uuid PostgreSQL RPC PostgREST returns HTTP 200 + JSON string.
  if(result.status!==(linked?200:201)||
     !/application\/json/i.test(result.headers.get("content-type")||"")){
    throw Error("M3 Sandbox insert was rejected or could not be verified");
  }
  const announced=Number(result.headers.get("content-length")??"0");
  if(!Number.isSafeInteger(announced)||announced>8192){
    throw Error("M3 Sandbox insert response is too large");
  }
  const body=await result.text();
  if(Buffer.byteLength(body,"utf8")>8192)throw Error("M3 Sandbox insert response is too large");
  let inserted:unknown;
  try{inserted=JSON.parse(body) as unknown;}catch{
    throw Error("M3 Sandbox insert response is invalid");
  }
  let createdId:string;
  if(linked){
    if(typeof inserted!=="string"||!UUID.test(inserted)){
      throw Error("M3 Sandbox did not confirm exactly one created note");
    }
    createdId=inserted;
  }else{
    if(!Array.isArray(inserted)||inserted.length!==1||
       !inserted[0]||typeof inserted[0]!=="object"||
       (inserted[0] as {slug?:unknown}).slug!==d.slug||
       typeof (inserted[0] as {id?:unknown}).id!=="string"||
       !UUID.test((inserted[0] as {id:string}).id)){
      throw Error("M3 Sandbox did not confirm exactly one created note");
    }
    createdId=(inserted[0] as {id:string}).id;
  }

  // A successful HTTP status is not sufficient for Baseline changes. Re-read
  // the complete Sandbox inventory; an ambiguous result requires manual review,
  // never an automatic retry (the insert might already have committed).
  const after=await fetchNeonSandboxFingerprints({
    branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
  });
  const created=after.fingerprints.find(n=>n.slug===d.slug);
  if(after.numberOfNotes!==before.numberOfNotes+1||
     !created||created.sha256!==d.expectedLocalSha||!created.revision){
    throw Error("M3 Sandbox insert needs manual reconciliation; Baseline not saved");
  }
  if(linked){
    const reconcile=():never=>{
      throw Error("M3 linked Sandbox insert needs manual reconciliation; Baseline not saved");
    };
    // The returned RPC UUID must be the identity of the newly indexed note,
    // not merely an arbitrary successful scalar from an unexpected function.
    const noteUrl=new URL(endpoint.href.replace(/\/$/,"")+"/knowledge_notes");
    noteUrl.searchParams.set("select","id,slug,updated_at");
    noteUrl.searchParams.set("slug","eq."+d.slug);
    noteUrl.searchParams.set("limit","2");
    const noteResponse=await request(noteUrl.href,{
      method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{Authorization:"Bearer "+args.sandboxOwnerJwt,Accept:"application/json",
        "Cache-Control":"no-store",Prefer:"count=exact"},
      signal:AbortSignal.timeout(16000),
    });
    if(noteResponse.status!==200||
       !/application\/json/i.test(noteResponse.headers.get("content-type")||"")||
       noteResponse.headers.get("content-range")?.trim()!=="0-0/1")reconcile();
    const noteRaw=await noteResponse.text();
    if(Buffer.byteLength(noteRaw,"utf8")>2048)reconcile();
    let witnessed:unknown;
    try{witnessed=JSON.parse(noteRaw) as unknown;}catch{reconcile();}
    if(!Array.isArray(witnessed)||witnessed.length!==1||
       !witnessed[0]||typeof witnessed[0]!=="object"||
       (witnessed[0] as {id?:unknown}).id!==createdId||
       (witnessed[0] as {slug?:unknown}).slug!==d.slug||
       typeof (witnessed[0] as {updated_at?:unknown}).updated_at!=="string"||
       createHash("sha256").update(createdId+":"+
         (witnessed[0] as {updated_at:string}).updated_at).digest("hex")!==created.revision){
      reconcile();
    }

    // Verify the real RLS-filtered backlinks created by the SAME RPC.
    // A good note SHA without its expected index is not a successful create.
    const linkUrl=new URL(endpoint.href.replace(/\/$/,"")+"/knowledge_links");
    linkUrl.searchParams.set("select","target_key");
    linkUrl.searchParams.set("source_note_id","eq."+createdId);
    linkUrl.searchParams.set("order","target_key.asc");
    linkUrl.searchParams.set("limit",String(wikiKeys.length+1));
    const linkResponse=await request(linkUrl.href,{
      method:"GET",redirect:"manual",credentials:"omit",cache:"no-store",
      headers:{Authorization:"Bearer "+args.sandboxOwnerJwt,Accept:"application/json",
        "Cache-Control":"no-store",Prefer:"count=exact"},
      signal:AbortSignal.timeout(16000),
    });
    if(linkResponse.status!==200||
       !/application\/json/i.test(linkResponse.headers.get("content-type")||"")||
       linkResponse.headers.get("content-range")?.trim()!==
         "0-"+(wikiKeys.length-1)+"/"+wikiKeys.length)reconcile();
    const linkRaw=await linkResponse.text();
    if(Buffer.byteLength(linkRaw,"utf8")>16000)reconcile();
    let linkedRows:unknown;
    try{linkedRows=JSON.parse(linkRaw) as unknown;}catch{reconcile();}
    if(!Array.isArray(linkedRows))reconcile();
    const rows=linkedRows as unknown[];
    if(rows.length!==wikiKeys.length)reconcile();
    const keys:string[]=[];
    for(const item of rows){
      if(!item||typeof item!=="object"||Array.isArray(item)||
         Object.keys(item).length!==1||
         typeof (item as {target_key?:unknown}).target_key!=="string"){
        reconcile();
      }
      keys.push((item as {target_key:string}).target_key);
    }
    if(JSON.stringify(keys.sort())!==JSON.stringify([...wikiKeys].sort()))reconcile();

    // Last inventory pass catches changes between the first note check and
    // index verification. Never use the RPC result alone to save a Baseline.
    const final=await fetchNeonSandboxFingerprints({
      branchId:args.branchId,jwt:args.sandboxOwnerJwt,fetcher:request,
    });
    const finalNote=final.fingerprints.find(n=>n.slug===d.slug);
    if(final.numberOfNotes!==after.numberOfNotes||
       finalNote?.sha256!==created.sha256||
       finalNote?.revision!==created.revision)reconcile();
  }
  return {slug:d.slug,sha256:created.sha256,revision:created.revision,
    baselineSaved:false};
}
