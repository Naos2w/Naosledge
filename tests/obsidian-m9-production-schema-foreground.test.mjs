import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {RELEASE_DATA_API_URL}
  from "../lib/neon/production-release.ts";
import {
  assertM9SchemaReaderConnection,verifiedM9Sql003Rows,
  verifiedM9SchemaReaderRows,M9_SCHEMA_READER_ROLE,
} from "../lib/obsidian-m9-production-schema-readiness.ts";
import {
  assertM9ForegroundInvocation,parseM9ForegroundStart,
  controlM9ForegroundAgent,safeM9AgentStatus,
} from "../scripts/obsidian-m9-windows-foreground-auto-agent.ts";

const host=new URL(RELEASE_DATA_API_URL).hostname.replace(".apirest.",".");
const conn=(hostname=host,role=M9_SCHEMA_READER_ROLE)=>
  "postgresql://"+role+":synthetic-not-a-real-password@"+
  hostname+"/neondb?sslmode=require";
const instruction="START M9 OWNER FOREGROUND AGENT";
const config=url=>JSON.stringify({
  readOnlySchemaConnectionString:url,typedConfirmation:instruction,
});
function knownGood(){
  return {
    notes_present:true,links_present:true,notes_rls_enabled:true,
    links_rls_enabled:true,cas_rpc_present:true,
    cas_security_invoker:true,cas_pinned_search_path:true,
    authenticated_can_execute:true,anonymous_can_execute:false,
    m7_schema_ready:true,
  };
}
test("SQL003 Production connection is pinned to the actual endpoint and dedicated read-only role",()=>{
  assert.doesNotThrow(()=>assertM9SchemaReaderConnection(conn()));
  const reject=[
    conn("sandbox.neon.tech"),
    conn(host,"neondb_owner"),
    conn(host,"postgres"),
    conn().replace("/neondb?","/otherdb?"),
    conn().replace("sslmode=require","sslmode=disable"),
    conn()+"&application_name=secret",
    conn().replace("postgresql://","http://"),
    conn().replace(host,host+".evil.example"),
    conn().replace("synthetic-not-a-real-password","short"),
    conn().replace("neondb?","neondb#secret?"),
    conn().replace("schema_reader","schema_reader%0a"),
    "not a connection",
  ];
  for(const bad of reject){
    assert.throws(()=>assertM9SchemaReaderConnection(bad),
      /SQL003 runtime readiness unavailable/);
  }
});
test("SQL003 Provider accepts only a complete, correctly typed, fail-closed ACL vector",()=>{
  assert.equal(verifiedM9Sql003Rows([knownGood()]),true);
  assert.equal(verifiedM9Sql003Rows(true),false);
  assert.equal(verifiedM9Sql003Rows([]),false);
  assert.equal(verifiedM9Sql003Rows([knownGood(),knownGood()]),false);
  for(const key of Object.keys(knownGood())){
    const bad={...knownGood(),[key]:key==="anonymous_can_execute"?true:false};
    assert.equal(verifiedM9Sql003Rows([bad]),false,key);
    const missing={...knownGood()};delete missing[key];
    assert.equal(verifiedM9Sql003Rows([missing]),false,"missing "+key);
    const wrong={...knownGood(),[key]:"true"};
    assert.equal(verifiedM9Sql003Rows([wrong]),false,"text "+key);
  }
  assert.equal(verifiedM9Sql003Rows([{...knownGood(),unexpected:true}]),false);
});
function knownReader(){
  return {
    reader_role:M9_SCHEMA_READER_ROLE,can_login:true,
    transaction_read_only:true,is_superuser:false,
    can_create_db_role:false,can_create_role:false,can_replicate:false,
    bypasses_rls:false,all_data_writer:false,can_create_database:false,
    can_create_public:false,can_read_notes:false,can_write_notes:false,
    can_read_links:false,can_write_links:false,
  };
}
test("SQL003 schema-reader must be a genuinely unprivileged catalog-only login",()=>{
  assert.equal(verifiedM9SchemaReaderRows([knownReader()]),true);
  assert.equal(verifiedM9SchemaReaderRows([]),false);
  assert.equal(verifiedM9SchemaReaderRows([knownReader(),knownReader()]),false);
  assert.equal(verifiedM9SchemaReaderRows(true),false);
  for(const key of Object.keys(knownReader())){
    const base=knownReader();
    const tampered={...base,[key]:
      key==='reader_role'?'not-the-approved-role':
      key==='can_login'||key==='transaction_read_only'?false:true};
    assert.equal(verifiedM9SchemaReaderRows([tampered]),false,key);
    const missing={...base};delete missing[key];
    assert.equal(verifiedM9SchemaReaderRows([missing]),false,'missing '+key);
    const wrongType={...base,[key]:'false'};
    assert.equal(verifiedM9SchemaReaderRows([wrongType]),false,'type '+key);
  }
  assert.equal(verifiedM9SchemaReaderRows([{...knownReader(),extra:true}]),false);
});
test("SQL003 runtime uses the reviewed SQL text, without changing the production migration",async()=>{
  const sql=await readFile(new URL(
    "../neon/m7_schema_readiness_readonly.sql",import.meta.url),"utf8");
  const canonical=sql.replace(/\r\n/g,"\n");
  assert.equal(createHash("sha256").update(canonical).digest("hex"),
    "873e5baf96f4da8173da0d3eb69276314ace6004d5944b9caec84081af21e0d7");
  assert.equal(createHash("sha256").update(canonical.replace(/\n/g,"\r\n")).digest("hex")!==
    createHash("sha256").update(canonical).digest("hex"),true,
    "the checked hash is canonical across Windows and Linux");
  assert.match(sql,/m7_schema_ready/);
  assert.doesNotMatch(sql,/\b(DELETE|INSERT|TRUNCATE|DROP|ALTER|CREATE)\s+(?:TABLE|FUNCTION|INTO|FROM)\b/i);
});
test("M9 foreground start is MSI-only, exact flag, private pipe and explicit operator confirmation",()=>{
  const good={platform:"win32",host:"msi",
    flags:["--m9-owner-foreground-auto-agent"],stdinIsTty:false};
  assert.doesNotThrow(()=>assertM9ForegroundInvocation(good));
  for(const bad of [
    {...good,platform:"linux"},
    {...good,host:"PC2"},
    {...good,stdinIsTty:true},
    {...good,flags:[]},
    {...good,flags:[...good.flags,"--autostart"]},
  ])assert.throws(()=>assertM9ForegroundInvocation(bad));
  assert.equal(parseM9ForegroundStart(config(conn()))
    .typedConfirmation,instruction);
  for(const bad of [
    "{}",JSON.stringify({typedConfirmation:instruction}),
    JSON.stringify({readOnlySchemaConnectionString:conn(),
      typedConfirmation:"RUN"}),
    JSON.stringify({readOnlySchemaConnectionString:conn(),
      typedConfirmation:instruction,extra:true}),
    config(conn("unknown.neon.tech")),
    "x".repeat(4100),
  ])assert.throws(()=>parseM9ForegroundStart(bad));
});
test("M9 foreground operator has actual pause/resume/status/stop controls, and never auto-clears faults",async()=>{
  const statuses=[];
  let state="running",paused=0,resumed=0;
  const agent={
    status:()=>({
      state,scans:2,faults:0,last:null,
      tokenStored:false,ownerPinned:true,
      autoTransferProcessRunning:state==="running",
      automaticDeletionAllowed:false,
    }),
    pause:()=>{state="paused";paused++;},
    resume:async()=>{state="running";resumed++;},
  };
  const raw=safeM9AgentStatus(agent.status());
  assert.equal(raw.state,"running");
  assert.doesNotMatch(JSON.stringify(raw),/jwt|cookie|password|ownerPinned/);
  statuses.push((await controlM9ForegroundAgent(agent,"status")).status.state);
  statuses.push((await controlM9ForegroundAgent(agent,"pause")).status.state);
  statuses.push((await controlM9ForegroundAgent(agent,"resume")).status.state);
  assert.deepEqual(statuses,["running","paused","running"]);
  assert.equal(paused,1);
  assert.equal(resumed,1);
  assert.deepEqual(await controlM9ForegroundAgent(agent,"stop"),
    {command:"stop",stop:true});
  await assert.rejects(controlM9ForegroundAgent(agent,"clear-latch"),
    /control rejected/);
  assert.equal(state,"running","stop is drained by run's finally, not an unguarded instruction");
});
