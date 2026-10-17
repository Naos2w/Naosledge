/**
 * LIVE Neon Sandbox-only Second Brain P1/P2 JWT/Data API test.
 * Explicit opt-in, fixed sandbox endpoints, synthetic @example.com users.
 * No Production, no Vercel deploy, no outgoing test-email, no credentials in
 * stdout, files, Git or CI. Credentials exist only in this Node process RAM.
 *
 * It waits for a separate, manually authorized SYNTHETIC admin grant in the
 * Sandbox only; the test itself cannot assign database permissions.
 */
import assert from "node:assert/strict";
import {randomBytes, randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";

const BRANCH="br-quiet-sunset-b4xx4pnx";
const AUTH="https://ep-square-cloud-b45d18zl.neonauth.c-6.us-east-2.aws.neon.tech/neondb/auth";
const API="https://ep-square-cloud-b45d18zl.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1";
const ORIGIN="http://localhost:3000";
if(process.env.NAOSLEDGE_KNOWLEDGE_E2E_ALLOW!==BRANCH ||
  process.env.NAOSLEDGE_NEON_BRANCH_ID!==BRANCH ||
  process.env.CI==="true") {
  throw new Error("SANDBOX_ONLY_GUARD: explicit sandbox branch authorization required; CI forbidden");
}
const nonce=randomBytes(7).toString("hex");
const fixtures={owner:null,bob:null,reader:null};
const created={ownerNotes:[],bobNotes:[],postIds:[]};
let allSuccessful=false;
let cleanupFailures=0;

const headersBase={"Origin":ORIGIN,"Content-Type":"application/json"};
async function call(base, path, {method="GET", token, cookie, payload, rows=false}={}) {
  const headers={...headersBase};
  if(token) headers.Authorization="Bearer "+token;
  if(cookie) headers.Cookie=cookie;
  if(rows) headers.Prefer="return=representation";
  const res=await fetch(base+path,{
    method,headers,body:payload===undefined?undefined:JSON.stringify(payload),
    redirect:"manual",signal:AbortSignal.timeout(16000),
  });
  let data=null;try{data=await res.json()}catch{/* no body */}
  const code=data && typeof data==="object" && !Array.isArray(data)?String(data.code||data.error_code||""):undefined;
  return {status:res.status,headers:res.headers,data,code};
}
function success(response,label,allowed=[200,201,204]) {
  if(!allowed.includes(response.status))throw Error(label+": HTTP "+response.status+" code="+(response.code||"none"));
  return response;
}
function denied(response,label) {
  if(![401,403].includes(response.status))throw Error(label+": expected unauthorized 401/403; saw HTTP "+response.status+" code="+(response.code||"none"));
}
function rows(response,label) {
  success(response,label);
  if(!Array.isArray(response.data)) throw Error(label+": expected array result");
  return response.data;
}
function subject(jwt) {
  if(typeof jwt!=="string"||jwt.split(".").length!==3)return null;
  try {return JSON.parse(Buffer.from(jwt.split(".")[1],"base64url").toString("utf8")).sub}
  catch{return null}
}
async function signUp(role) {
  const email="naosledge-vaultqa-"+role+"-"+nonce+"@example.com";
  const password=randomBytes(30).toString("base64url")+"aA1!";
  const signup=success(await call(AUTH,"/sign-up/email",{
    method:"POST",
    payload:{email,password,name:"Synthetic Vault QA "+role,callbackURL:ORIGIN},
  }),role+" signup",[200,201]);
  const id=signup.data?.user?.id;
  if(typeof id!=="string" || id.length<8 || id.length>256)throw Error(role+" signup did not return a valid user ID");
  const cookie=signup.headers.getSetCookie?.().map(v=>v.split(";")[0]).join("; ")||"";
  if(!cookie)throw Error(role+" signup did not create an Auth cookie");
  const session=success(await call(AUTH,"/get-session",{cookie}),role+" session");
  const token=session.headers.get("set-auth-jwt");
  if(subject(token)!==id)throw Error(role+" JWT subject did not match the created synthetic user");
  console.log("SYNTHETIC_USER role="+role+" id="+id+" email_suffix=@example.com");
  return {role,id,email,password,token};
}
const get=(table,token,query="select=*")=>
  call(API,"/"+table+"?"+query,{token});
const api=(path,params)=>call(API,path,params);
const rpc=(fn,token,payload)=>
  api("/rpc/"+fn,{method:"POST",token,payload,rows:true});
const uuid=(res,label)=>{
  success(res,label);
  const d=res.data;
  const id=typeof d==="string"?d:d?.id||d?.note_id||d?.post_id;
  if(typeof id!=="string"||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
    throw Error(label+": did not return UUID; status="+res.status);
  }
  return id;
};
const slug=(name)=>"vaultqa-"+name+"-"+nonce;
const date="2026-10-17";
function notePayload(id,title,key,markdown) {
  return {
    p_id:id||null,p_title:title,p_slug:slug(key),
    p_summary:"Synthetic Neon Sandbox Vault QA",
    p_content_md:markdown,p_category:"驗證",
    p_tags:["qa","知識測試"],p_learned_on:date,
    p_links:markdown.includes("[[")?["neon auth","not-created-yet"]:[],
  };
}
async function cleanupAs(identity,table,id){
  const result=await api("/"+table+"?id=eq."+encodeURIComponent(id),{
    method:"DELETE",token:identity.token,rows:true,
  });
  if(![200,204].includes(result.status))throw Error("cleanup "+table+" HTTP "+result.status+" code="+(result.code||"none"));
}
console.log("SANDBOX_E2E_STARTED fixture_nonce="+nonce+" target="+BRANCH);
try {
  const anonToken=success(await call(AUTH,"/token/anonymous"),"anonymous JWT").data?.token;
  if(typeof anonToken!=="string"||anonToken.split(".").length!==3)throw Error("Missing anonymous JWT");
  denied(await get("knowledge_notes",anonToken,"select=id"),"anonymous private notes");
  denied(await get("knowledge_links",anonToken,"select=target_key"),"anonymous links");
  denied(await get("knowledge_publication_sources",anonToken,"select=note_id"),"anonymous publication mappings");
  denied(await rpc("search_knowledge_notes",anonToken,{p_query:"secret",p_limit:10}),"anonymous search function");
  console.log("PASS anonymous JWT cannot read private tables or search RPC");
  for(const role of ["owner","bob","reader"])fixtures[role]=await signUp(role);
  const {owner,bob,reader}=fixtures;
  for(const user of [owner,bob,reader]) {
    assert.equal(rows(await get("blog_admins",user.token,"select=user_id"),"prior admin status").length,0);
    assert.equal(rows(await get("knowledge_notes",user.token,"select=id"),"prior private notes").length,0);
  }
  const guestCreate=await rpc("save_knowledge_note",reader.token,notePayload(null,"Forbidden", "reader-denied", "guest"));
  denied(guestCreate,"non-admin RPC");
  console.log("PASS synthetic Auth/real Neon JWT pre-grant RLS denies non-admin");
  console.log("WAITING_FOR_SANDBOX_ADMIN_GRANT owner_id="+owner.id+" bob_id="+bob.id+" reader_id="+reader.id+" branch="+BRANCH);
  let granted=false;
  for(let i=0;i<120;i++){
    const ownerAdmin=rows(await get("blog_admins",owner.token,"select=user_id"),"owner grant");
    const bobAdmin=rows(await get("blog_admins",bob.token,"select=user_id"),"bob grant");
    if(ownerAdmin.some(x=>x.user_id===owner.id)&&bobAdmin.some(x=>x.user_id===bob.id)){
      granted=true;break;
    }
    await delay(1000);
  }
  if(!granted)throw Error("Synthetic owner/bob sandbox grant timeout");
  console.log("PASS synthetic owner and bob grants observed via signed JWT/RLS");

  const ownerNode=uuid(await rpc("save_knowledge_note",owner.token,notePayload(null,"Neon Auth","neon-auth","我記得神經元知識，Neon Auth 使用 JWT。")),"owner create private note");
  created.ownerNotes.push(ownerNode);
  const linkMarkdown="[[neon-auth|Neon Auth]] 與 RLS，還有 [[not-created-yet]]。";
  const ownerLink=uuid(await rpc("save_knowledge_note",owner.token,{
    ...notePayload(null,"RLS 權限","rls-security",linkMarkdown),
    p_links:["neon-auth","not-created-yet"],
  }),"owner create linked note");
  created.ownerNotes.push(ownerLink);
  const bobNode=uuid(await rpc("save_knowledge_note",bob.token,{
    ...notePayload(null,"Bob Private","bob-private","Bob 特別私密知識"),
    p_links:[],
  }),"bob create isolated note");
  created.bobNotes.push(bobNode);

  const ownerRows=rows(await get("knowledge_notes",owner.token,"select=id,slug,title&order=slug.asc"),"owner list");
  assert.equal(ownerRows.length,2);
  const bobRows=rows(await get("knowledge_notes",bob.token,"select=id,slug&order=slug.asc"),"bob list");
  assert.deepEqual(bobRows.map(x=>x.id),[bobNode]);
  assert.deepEqual(rows(await get("knowledge_notes",reader.token,"select=id"),"reader list"),[]);
  const directBobFromOwner=rows(await get("knowledge_notes",owner.token,"select=id&id=eq."+bobNode),"cross-owner read");
  assert.equal(directBobFromOwner.length,0);
  const ownerSearch=rows(await rpc("search_knowledge_notes",owner.token,{p_query:"神經元",p_limit:50}),"Chinese private search");
  assert.deepEqual(ownerSearch.map(x=>x.id),[ownerNode]);
  const englishSearch=rows(await rpc("search_knowledge_notes",owner.token,{p_query:"RLS",p_limit:50}),"Latin fulltext private search");
  assert.ok(englishSearch.some(x=>x.id===ownerLink));
  assert.equal(rows(await rpc("search_knowledge_notes",bob.token,{p_query:"神經元",p_limit:50}),"cross-owner Chinese search").length,0);
  console.log("PASS private CRUD, distinct admin-owner isolation, non-admin denial, Chinese/Latin search");

  const backlink=rows(await get("knowledge_links",owner.token,"select=source_note_id,target_key&source_note_id=eq."+ownerLink),"outgoing wiki references");
  assert.deepEqual(backlink.map(x=>x.target_key).sort(),["neon-auth","not-created-yet"]);
  assert.deepEqual(rows(await get("knowledge_links",bob.token,"select=target_key"),"bob backlinks"),[]);
  const unauthorizedDelete=rows(success(await api("/knowledge_notes?id=eq."+ownerNode,{method:"DELETE",token:bob.token,rows:true}),"bob denied delete"),"bob denied delete");
  assert.deepEqual(unauthorizedDelete,[]);
  const forbiddenRpc=await rpc("save_knowledge_note",reader.token,notePayload(null,"Bad","should-not-exist","bad"));
  denied(forbiddenRpc,"reader unauthorized private save");
  const update=uuid(await rpc("save_knowledge_note",owner.token,{
    ...notePayload(ownerLink,"RLS Updated","rls-security","[[neon-auth]]"),
    p_links:["neon-auth"],
  }),"atomic wiki update");
  assert.equal(update,ownerLink);
  const after=rows(await get("knowledge_links",owner.token,"select=target_key&source_note_id=eq."+ownerLink),"links replaced");
  assert.deepEqual(after.map(x=>x.target_key),["neon-auth"]);
  console.log("PASS real wiki links, backlinks lookup, atomic replacement, cross-owner denial");

  const postId=uuid(await rpc("create_knowledge_public_draft",owner.token,{
    p_note_id:ownerNode,p_public_slug:slug("public-draft"),
    p_review_content_md:"這是安全、經檢查的合成公開副本文字。",
  }),"private knowledge creates public draft");
  created.postIds.push(postId);
  const posts=rows(await get("posts",owner.token,"select=id,status,published_at,content_md&id=eq."+postId),"draft snapshot");
  assert.equal(posts.length,1);
  assert.equal(posts[0].status,"draft");
  assert.equal(posts[0].published_at,null);
  assert.equal(posts[0].content_md,"這是安全、經檢查的合成公開副本文字。");
  assert.deepEqual(rows(await get("posts",anonToken,"select=id&id=eq."+postId),"anon must not see draft"),[]);
  assert.deepEqual(rows(await get("posts",reader.token,"select=id&id=eq."+postId),"reader must not see draft"),[]);
  denied(await rpc("create_knowledge_public_draft",reader.token,{
    p_note_id:ownerNode,p_public_slug:slug("guest-public"),
    p_review_content_md:"bad",
  }),"guest publishing RPC");
  const privateMap=rows(await get("knowledge_publication_sources",owner.token,"select=note_id,post_id&post_id=eq."+postId),"private publication mapping");
  assert.deepEqual(privateMap.map(x=>x.note_id),[ownerNode]);
  assert.deepEqual(rows(await get("knowledge_publication_sources",bob.token,"select=post_id"),"bob publishing mapping"),[]);
  console.log("PASS manually reviewed draft snapshot only; private/public mapping RLS");

  if(process.env.NAOSLEDGE_KNOWLEDGE_WEBSITE_BROWSER==="1") {
    const {verifyVaultBrowser}=await import("./vault-website-browser.mjs");
    await verifyVaultBrowser({
      owner,bob,reader,authUrl:AUTH,dataApiUrl:API,branch:BRANCH,nonce,
      record:(kind,who,id)=>{
        if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
          throw Error("Browser fixture ID not a UUID");
        }
        if(kind==="post" && who.id===owner.id)created.postIds.push(id);
        else if(kind==="note" && who.id===owner.id)created.ownerNotes.push(id);
        else if(kind==="note" && who.id===bob.id)created.bobNotes.push(id);
        else throw Error("Unrecognized browser fixture owner or type");
      },
    });
  }

  allSuccessful=true;
  console.log("SANDBOX_KNOWLEDGE_E2E_PASS live Neon Better Auth, JWT, RLS, indexed search, backlinks and draft-snapshot");
} catch(error) {
  process.exitCode=1;
  console.error("SANDBOX_KNOWLEDGE_E2E_FAILURE "+String(error?.message||"unknown").slice(0,260));
} finally {
  for(const id of [...created.postIds].reverse()){
    try {await cleanupAs(fixtures.owner,"posts",id)}
    catch(e){cleanupFailures++;console.error("CLEANUP_POST_FAILED id="+id+" "+String(e.message).slice(0,110))}
  }
  for(const id of [...created.ownerNotes].reverse()){
    try {await cleanupAs(fixtures.owner,"knowledge_notes",id)}
    catch(e){cleanupFailures++;console.error("CLEANUP_NOTE_FAILED id="+id+" "+String(e.message).slice(0,110))}
  }
  for(const id of [...created.bobNotes].reverse()){
    try {await cleanupAs(fixtures.bob,"knowledge_notes",id)}
    catch(e){cleanupFailures++;console.error("CLEANUP_NOTE_FAILED id="+id+" "+String(e.message).slice(0,110))}
  }
  try{
    if(fixtures.owner){
      const empty=rows(await get("knowledge_notes",fixtures.owner.token,"select=id"),"post-cleanup owner list");
      if(empty.length!==0)throw Error("owner rows remain");
    }
    if(fixtures.bob){
      const empty=rows(await get("knowledge_notes",fixtures.bob.token,"select=id"),"post-cleanup bob list");
      if(empty.length!==0)throw Error("bob rows remain");
    }
  }catch(err){cleanupFailures++;console.error("CLEANUP_VERIFY_FAILED "+String(err.message).slice(0,130))}
  console.log("SANDBOX_CLEANUP_PENDING_AUTH_GRANTS Users must be deleted by Neon connector; test_user_ids="+Object.values(fixtures).filter(Boolean).map(x=>x.id).join(","));
  console.log("SANDBOX_CLEANUP_APP_RECORDS "+(cleanupFailures?"INCOMPLETE":"CLEAN")+" fixture_nonce="+nonce+" test_pass="+allSuccessful);
  if(cleanupFailures)process.exitCode=1;
}
