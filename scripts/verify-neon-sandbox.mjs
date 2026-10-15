/**
 * Manually invoked, SANDBOX-ONLY live Neon Auth + Data API security smoke.
 * Never run in CI or against production.
 *
 * Configuration (all PUBLIC endpoints, never passwords or connection strings):
 * NAOSLEDGE_NEON_SANDBOX_AUTH_URL
 * NAOSLEDGE_NEON_SANDBOX_DATA_API_URL
 * NAOSLEDGE_NEON_SANDBOX_ENDPOINT
 * NAOSLEDGE_NEON_SANDBOX_BRANCH_ID
 *
 * First create synthetic users. Print their test IDs, then poll until the
 * operator grants ONLY the synthetic owner ID in the ISOLATED sandbox via
 * the Neon connector. JWTs and generated passwords exist in process RAM only.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://localhost:3000";
const authUrl = process.env.NAOSLEDGE_NEON_SANDBOX_AUTH_URL;
const apiUrl = process.env.NAOSLEDGE_NEON_SANDBOX_DATA_API_URL;
const endpoint = process.env.NAOSLEDGE_NEON_SANDBOX_ENDPOINT;
const branch = process.env.NAOSLEDGE_NEON_SANDBOX_BRANCH_ID;
const expectedBranch = "br-quiet-sunset-b4xx4pnx";
const knownProductionEndpoint = "ep-purple-recipe-b43kznn2";

function safeUrl(address, label, prefix, pathname) {
  if (!address || !endpoint || branch !== expectedBranch)
    throw new Error("SANDBOX_GUARD: approved branch/endpoint missing or mismatched");
  const u = new URL(address);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
      !u.hostname.startsWith(endpoint + "." + prefix + ".") ||
      !u.hostname.endsWith(".aws.neon.tech") ||
      u.hostname.startsWith(knownProductionEndpoint + ".") ||
      u.pathname !== pathname)
    throw new Error("SANDBOX_GUARD: expected Neon test-only URL");
  return u.href.replace(/\/$/, "");
}
const a = safeUrl(authUrl, "auth", "neonauth", "/neondb/auth");
const d = safeUrl(apiUrl, "data api", "apirest", "/neondb/rest/v1");
const uid = randomUUID().slice(0, 12);

const basicHeaders = { Origin: origin, "Content-Type": "application/json" };
async function call(url, { method="GET", token, cookie, body, returnRows=false }={}) {
  const headers = {...basicHeaders};
  if (token) headers.Authorization = "Bearer " + token;
  if (cookie) headers.Cookie = cookie;
  if (returnRows) headers.Prefer = "return=representation";
  const response = await fetch(url, {
    method, headers, body:body===undefined?undefined:JSON.stringify(body),
    redirect:"manual", signal:AbortSignal.timeout(16000),
  });
  let data;
  try {data = await response.json();} catch {data = null;}
  return { status:response.status, data, headers:response.headers,
    code: data && !Array.isArray(data) && typeof data==="object" ? data.code || data.error_code || "none" : "none"};
}
function requireSuccess(result, label, accepted=[200,201,204]) {
  if (!accepted.includes(result.status))
    throw new Error(label + ": HTTP " + result.status + ", safe_code=" + result.code);
  return result;
}
function jwtSubject(jwt) {
  if (typeof jwt !== "string" || jwt.split(".").length !== 3) return null;
  try {return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).sub;} catch{return null;}
}
async function anonymousToken() {
  const result = requireSuccess(await call(a + "/token/anonymous"), "anonymous token");
  assert.equal(typeof result.data?.token, "string");
  assert.equal(result.data.token.split(".").length, 3);
  return result.data.token;
}
async function signedUpUser(role) {
  const email = "naosledge-" + role + "-" + uid + "@example.com";
  const password = randomBytes(32).toString("base64url") + "aA1!";
  const result = requireSuccess(await call(a + "/sign-up/email", {
    method:"POST",body:{email,password,name:"Naosledge Sandbox " + role,callbackURL:origin},
  }), role + " signup");
  const id = result.data?.user?.id;
  if (typeof id !== "string" || !id) throw new Error(role + ": no user ID in signup response");
  console.log("SANDBOX_SYNTHETIC_USER " + role + " id=" + id + " email_suffix=@example.com");
  const cookies = result.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map(value => value.split(";")[0]).join("; ");
  if (!cookie) throw new Error(role + ": missing sandbox auth session cookie");
  const session = requireSuccess(await call(a + "/get-session", {cookie}), role + " session");
  const token = session.headers.get("set-auth-jwt");
  if (jwtSubject(token) !== id) throw new Error(role + ": signed JWT subject does not match");
  return {id,token,role};
}
async function list(table, token, params="select=*") {
  return requireSuccess(await call(d + "/" + table + "?" + params, {token}), "list " + table);
}
function ids(result) {
  if (!Array.isArray(result.data)) throw new Error("Expected PostgREST response array");
  return result.data;
}
function notePayload(slug) {
  return {
    slug,title:"Sandbox QA article",excerpt:"Synthetic only",
    content_md:"## Test\n\nThis synthetic post tests access policy.",
    tags:["qa"],category:"驗證",status:"draft", learned_on:"2026-10-15",
  };
}
let owner;
let guest;
let createdSlug;
try {
  const anon = await anonymousToken();
  const initial = ids(await list("posts", anon, "select=slug&status=eq.published"));
  assert.equal(initial.length, 0, "Sandbox initially has no synthetic public post");
  const hidden = await call(d + "/blog_admins?select=user_id", {token:anon});
  assert.equal(hidden.status, 403, "Anonymous must have no access to admin table");
  console.log("PASS anonymous real JWT, no admin table access");

  owner = await signedUpUser("owner");
  guest = await signedUpUser("reader");
  assert.equal(ids(await list("blog_admins", guest.token, "select=user_id")).length, 0,
    "Non-admin cannot read admin IDs");
  assert.equal(ids(await list("blog_admins", owner.token, "select=user_id")).length, 0,
    "New test owner not admin until explicit DB insertion");
  console.log("PASS synthetic signups, session JWTs, non-admin isolation");

  const guestAttempt = await call(d + "/posts", {
    method:"POST",token:guest.token,body:notePayload("sandbox-guest-denied-" + uid),returnRows:true,
  });
  assert.equal(guestAttempt.status, 403, "Unprivileged user insert must fail");
  console.log("PASS non-admin INSERT blocked, safe_code=" + guestAttempt.code);
  console.log("WAITING_FOR_SANDBOX_ADMIN_GRANT owner_id=" + owner.id + " branch=" + branch);

  let assigned = false;
  for (let attempt=0;attempt<90;attempt++) {
    const rows = ids(await list("blog_admins", owner.token, "select=user_id"));
    if (rows.some(row=>row.user_id===owner.id)) {assigned=true;break;}
    await delay(1000);
  }
  if (!assigned) throw new Error("SANDBOX_ADMIN_GRANT_TIMEOUT: owner not assigned");
  console.log("PASS synthetic owner admin grant observed through real Neon RLS");

  createdSlug = "naosledge-qa-" + uid;
  const creation = requireSuccess(await call(d + "/posts", {
    method:"POST",token:owner.token,body:notePayload(createdSlug),returnRows:true,
  }), "owner INSERT", [201]);
  const created = ids(creation);
  assert.equal(created.length, 1);
  assert.equal(created[0].author_id, owner.id);
  assert.equal(created[0].status, "draft");
  const postId = created[0].id;
  console.log("PASS real Neon JWT owner INSERT and text ID default");

  const draftQuery = "select=id,slug,status&slug=eq." + createdSlug;
  assert.equal(ids(await list("posts",anon,draftQuery)).length,0);
  assert.equal(ids(await list("posts",guest.token,draftQuery)).length,0);
  assert.equal(ids(await list("posts",owner.token,draftQuery)).length,1);
  console.log("PASS real Data API anonymous/non-admin draft isolation");

  const otherUpdate = requireSuccess(await call(d + "/posts?slug=eq." + createdSlug, {
    method:"PATCH",token:guest.token,body:{title:"UNAUTHORIZED"},returnRows:true,
  }), "guest UPDATE", [200,204]);
  assert.equal(ids(otherUpdate).length,0);
  console.log("PASS non-admin UPDATE did not affect draft");

  const badOwner = await call(d + "/posts?id=eq." + postId, {
    method:"PATCH",token:owner.token,body:{author_id:guest.id},returnRows:true,
  });
  assert.equal(badOwner.status,403,"Owner cannot reassign author_id");
  console.log("PASS owner cannot impersonate another author");

  const publish = requireSuccess(await call(d + "/posts?id=eq." + postId, {
    method:"PATCH",token:owner.token,body:{
      status:"published",published_at:new Date().toISOString(),
    },returnRows:true,
  }), "owner PUBLISH");
  assert.equal(ids(publish)[0].status,"published");
  assert.equal(ids(await list("posts",anon,draftQuery)).length,1);
  assert.equal(ids(await list("posts",guest.token,draftQuery)).length,1);
  console.log("PASS owner publish makes article readable anonymously");

  const deletion = requireSuccess(await call(d + "/posts?id=eq." + postId, {
    method:"DELETE",token:owner.token,returnRows:true,
  }), "owner DELETE");
  assert.equal(ids(deletion).length,1);
  assert.equal(ids(await list("posts",anon,draftQuery)).length,0);
  createdSlug = undefined;
  console.log("PASS owner DELETE and anonymous no longer sees post");
  console.log("SANDBOX_SMOKE_SUCCESS all live Auth/JWT/Data API/RLS/CRUD assertions passed");
} catch(error) {
  const message = String(error?.message||"unknown").slice(0,400);
  console.error("SANDBOX_SMOKE_FAILURE " + message);
  if(createdSlug) console.error("SANDBOX_POSSIBLE_FIXTURE_SLUG " + createdSlug);
  process.exitCode=1;
}
