import test from "node:test";
import assert from "node:assert/strict";
import {
  isPrivateRoutePath,protectPrivateResponseHeaders,
} from "../lib/private-response-headers.ts";

test("all owner, private note, login and recovery routes are classified private",()=>{
  for(const path of [
    "/studio","/studio/new","/studio/00000000-0000-4000-8000-000000000001",
    "/vault","/vault/new","/vault/graph","/vault/00000000-0000-4000-8000-000000000001",
    "/login","/forgot-password","/reset-password",
    "/owner-activation","/owner-activation/reset","/owner-activation/verified",
  ]) assert.equal(isPrivateRoutePath(path),true,path);
});

test("unrelated public routes remain public, including deceptive prefixes",()=>{
  for(const path of [
    "/","/about","/notes/my-public-post","/sitemap.xml","/robots.txt",
    "/studio-public","/vaultish","/login-help","/forgot-passwords",
    "/reset-password-token","/owner-activation-example",
  ]) assert.equal(isPrivateRoutePath(path),false,path);
});

test("private responses deny caching, frames, referrers and indexing",()=>{
  for(const path of ["/studio","/vault/graph","/login","/reset-password","/owner-activation/reset"]){
    const headers=new Headers({
      "Cache-Control":"public, max-age=600",
      "X-Robots-Tag":"index, follow",
      "Referrer-Policy":"unsafe-url",
    });
    assert.equal(protectPrivateResponseHeaders(headers,path),true,path);
    assert.match(headers.get("cache-control")||"",/private.*no-store/);
    assert.equal(headers.get("referrer-policy"),"no-referrer");
    assert.equal(headers.get("x-robots-tag"),"noindex, nofollow, noarchive");
    assert.equal(headers.get("x-frame-options"),"DENY");
  }
});

test("Auth SDK Set-Cookie and redirect Location survive header hardening",()=>{
  const headers=new Headers({
    "Set-Cookie":"__Secure-neon-auth.session_token=synthetic; HttpOnly; Secure",
    "Location":"/login",
    "Vary":"Accept-Encoding",
  });
  protectPrivateResponseHeaders(headers,"/studio");
  assert.equal(headers.get("set-cookie"),
    "__Secure-neon-auth.session_token=synthetic; HttpOnly; Secure");
  assert.equal(headers.get("location"),"/login");
  assert.equal(headers.get("vary"),"Accept-Encoding");
});

test("public response headers stay untouched",()=>{
  const headers=new Headers({"Cache-Control":"public, s-maxage=300"});
  assert.equal(protectPrivateResponseHeaders(headers,"/notes/my-post"),false);
  assert.equal(headers.get("cache-control"),"public, s-maxage=300");
  assert.equal(headers.has("x-robots-tag"),false);
  assert.equal(headers.has("x-frame-options"),false);
});
