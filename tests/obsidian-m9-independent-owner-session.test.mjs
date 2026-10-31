import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,readdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createM9IndependentProductionOwnerSession}
  from "../lib/obsidian-m9-independent-owner-session.ts";
import {RELEASE_AUTH_URL,RELEASE_ORIGIN,RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";

const OWNER="00000000-0000-4000-8000-000000000041";
const OTHER="00000000-0000-4000-8000-000000000042";
const JWT=(sub=OWNER)=>"eyJhbGciOiJIUzI1NiJ9."+
  Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+3600}))
    .toString("base64url")+".signedfake";
const protect={
  seal:async bytes=>bytes.toString("base64"),
  unseal:async value=>Buffer.from(value,"base64"),
};
const COOKIE="originalsession12345678";
const ROTATED="rotatedsession12345678";
const answer=(payload,options={})=>new Response(JSON.stringify(payload),{
  status:options.status??200,
  headers:{
    "content-type":"application/json",...(options.headers||{}),
  },
});
function mock(options={}){
  let logins=0,renewals=0,tokens=0,rls=0;
  let rotate=false,denied=false,identity=OWNER,verified=true;
  let missingToken=false;
  const fetcher=async(uri,req)=>{
    const url=new URL(uri);
    assert.equal(req.redirect,"manual");
    assert.equal(req.credentials,"omit");
    assert.equal(req.cache,"no-store");
    if(url.origin===new URL(RELEASE_AUTH_URL).origin){
      assert.equal(req.headers.Origin,RELEASE_ORIGIN);
      if(url.pathname.endsWith("/sign-in/email")){
        logins++;
        assert.equal(req.method,"POST");
        assert.equal(JSON.parse(req.body).email,"synthetic@example.com");
        assert.equal(JSON.parse(req.body).password,"privatePassword123");
        return answer({user:{id:OWNER}},{
          headers:{"set-cookie":
            "__Secure-neon-auth.session_token="+COOKIE+"; Secure; HttpOnly; Path=/"},
        });
      }
      if(url.pathname.endsWith("/get-session")){
        renewals++;
        assert.equal(req.method,"GET");
        const inCookie=req.headers.Cookie;
        // First refresh receives the OLD cookie and issues a rotation.
        // Only the following refresh must present the rotated value.
        assert.equal(inCookie,
          "__Secure-neon-auth.session_token="+
          (rotate&&renewals>=3?ROTATED:COOKIE));
        if(denied)return answer({error:"SESSION_EXPIRED_PRIVATE"},{status:401});
        const u={id:identity,email:"synthetic@example.com",
          emailVerified:verified};
        return answer({user:u,session:{active:true}},{
          headers:rotate?{"set-cookie":
            "__Secure-neon-auth.session_token="+ROTATED+
            "; Secure; HttpOnly; Path=/"}:{},
        });
      }
      if(url.pathname.endsWith("/token")){
        tokens++;
        assert.equal(req.method,"GET");
        assert.equal(req.headers.Cookie,
          "__Secure-neon-auth.session_token="+
            (rotate&&renewals>=2?ROTATED:COOKIE));
        if(missingToken)return answer({token:null});
        return answer({token:JWT(identity)});
      }
      throw Error("Unexpected managed Auth route");
    }
    assert.equal(url.origin,new URL(RELEASE_DATA_API_URL).origin);
    assert.equal(req.method,"GET");
    rls++;
    const bearer=req.headers.Authorization;
    assert.equal(bearer,"Bearer "+JWT(identity));
    if(url.pathname.endsWith("/blog_admins")){
      return answer(identity===OWNER?[{user_id:OWNER}]:[],{
        headers:{"content-range":identity===OWNER?"0-0/1":"*/0"},
      });
    }
    if(url.pathname.endsWith("/knowledge_notes")){
      return answer([],{headers:{"content-range":"*/0"}});
    }
    throw Error("Unexpected Owner-RLS endpoint");
  };
  return {fetcher,
    get logins(){return logins},
    get renewals(){return renewals},
    get tokens(){return tokens},
    get rls(){return rls},
    set rotate(v){rotate=v},
    set missingToken(v){missingToken=v},
    set denied(v){denied=v},
    set identity(v){identity=v},
    set verified(v){verified=v},
  };
}
async function scratch(callback){
  const root=await mkdtemp(path.join(tmpdir(),"naosledge-m9-session-test-"));
  try{return await callback(root);}
  finally{await rm(root,{recursive:true,force:true});}
}
const credentials={
  email:"synthetic@example.com",password:"privatePassword123",
  typedConfirmation:"ENROLL M9 INDEPENDENT PRODUCTION SESSION",
};
const store=(root,f)=>createM9IndependentProductionOwnerSession({
  testOnly:{storageRoot:root,protector:protect},fetcher:f.fetcher,
});

test("independent Neon Auth enrollment persists only a protected cookie, never plaintext password/JWT",async()=>{
  await scratch(async root=>{
    const api=mock(),session=store(root,api);
    const value=await session.enrollEmail(credentials);
    assert.deepEqual(value,{
      enrolled:true,ownerRlsVerified:true,credentialsLogged:false,
    });
    assert.equal(api.logins,1);
    assert.equal(api.renewals,1);
    assert.equal(api.tokens,1);
    assert.equal(api.rls,2);
    const files=(await readdir(root)).sort();
    assert.deepEqual(files,["session.dpapi"]);
    const disk=await readFile(path.join(root,files[0]),"utf8");
    assert.doesNotMatch(disk,/privatePassword123|originalsession12345678|signedfake|synthetic@example.com/);
    assert.equal((await session.requestFreshJwt()),JWT());
    assert.equal(api.renewals,2);
    assert.equal(api.tokens,2);
    assert.equal(api.rls,4);
    await assert.rejects(session.enrollEmail(credentials));
  });
});

test("managed Auth rotating cookie is resealed; future request uses only the rotated session",async()=>{
  await scratch(async root=>{
    const api=mock(),session=store(root,api);
    await session.enrollEmail(credentials);
    const before=await readFile(path.join(root,"session.dpapi"),"utf8");
    api.rotate=true;
    assert.equal(await session.requestFreshJwt(),JWT());
    const updated=await readFile(path.join(root,"session.dpapi"),"utf8");
    assert.notEqual(updated,before,"Rotating session must reseal the credential");
    assert.doesNotMatch(updated,/rotatedsession12345678/);
    assert.equal(await session.requestFreshJwt(),JWT());
    assert.equal(api.renewals,3);
    assert.equal(api.tokens,3);
    assert.equal(api.rls,6);
  });
});

test("expired independent session or unverified email cannot authorize RLS",async()=>{
  await scratch(async root=>{
    const api=mock(),session=store(root,api);
    api.verified=false;
    await assert.rejects(session.enrollEmail(credentials),/unavailable/);
    assert.deepEqual(await readdir(root),[]);
    api.verified=true;
    await session.enrollEmail(credentials);
    const encrypted=await readFile(path.join(root,"session.dpapi"));
    api.denied=true;
    await assert.rejects(session.requestFreshJwt(),error=>{
      assert.doesNotMatch(error.message,/SESSION_EXPIRED_PRIVATE/);
      return true;
    });
    assert.deepEqual(await readFile(path.join(root,"session.dpapi")),encrypted);
  });
});

test("missing /token JWT refuses refresh without changing the sealed session",async()=>{
  await scratch(async root=>{
    const api=mock(),session=store(root,api);
    await session.enrollEmail(credentials);
    const sealed=await readFile(path.join(root,"session.dpapi"));
    api.missingToken=true;
    await assert.rejects(session.requestFreshJwt(),/JWT|invalid|lifetime/);
    assert.deepEqual(await readFile(path.join(root,"session.dpapi")),sealed);
    assert.equal(api.rls,2,"JWT-less refresh must not reach Owner-RLS");
  });
});

test("Owner switch, wrong Origin and invalid cookie are rejected before storing any session",async()=>{
  await scratch(async root=>{
    const api=mock(),session=store(root,api);
    api.identity=OTHER;
    await assert.rejects(session.enrollEmail(credentials));
    assert.deepEqual(await readdir(root),[]);
    const invalid=createM9IndependentProductionOwnerSession({
      testOnly:{storageRoot:root,protector:protect},
      fetcher:async(uri,req)=>{
        if(new URL(uri).pathname.endsWith("/sign-in/email")){
          assert.equal(req.headers.Origin,RELEASE_ORIGIN);
          return answer({},{
            headers:{"set-cookie":
              "attacker.session_token=wrong; HttpOnly"},
          });
        }
        throw Error("Unexpected auth request");
      },
    });
    await assert.rejects(invalid.enrollEmail(credentials));
    assert.deepEqual(await readdir(root),[]);
  });
});

test("arbitrary disk paths, duplicate enrollment and unknown files fail closed without network",async()=>{
  await scratch(async root=>{
    let requests=0;
    const bad=createM9IndependentProductionOwnerSession({
      testOnly:{storageRoot:"C:\\Naos\\Obsidian\\Naosledge",
        protector:protect},
      fetcher:async()=>{requests++;throw Error("Must not call");},
    });
    await assert.rejects(bad.enrollEmail(credentials));
    assert.equal(requests,0);
    const api=mock(),session=store(root,api);
    await writeFile(path.join(root,"unknown.txt"),"unsafe");
    await assert.rejects(session.enrollEmail(credentials));
    await assert.rejects(session.requestFreshJwt());
    assert.equal(api.logins,0);
  });
});

test("source never reads browser cookies or stores plaintext secrets in logs/env",async()=>{
  const source=await readFile(new URL(
    "../lib/obsidian-m9-independent-owner-session.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/document\.cookie|localStorage|Get-Cookie|console\.log|process\.argv|process\.env\.NEON_AUTH_COOKIE_SECRET/);
  assert.match(source,/windowsM5KeyProtector/);
  assert.match(source,/Data API RLS|verifyM7ProductionOwnerReadOnly/);
});
