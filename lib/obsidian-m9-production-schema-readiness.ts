/**
 * M9 Production SQL003 readiness, checked on EVERY automatic scan.
 *
 * Unlike a successful Owner-RLS GET or an old operator SQL screenshot,
 * this executes the repository's exact, pinned read-only SQL003 metadata
 * gate against the approved Production Neon PostgreSQL endpoint.
 *
 * Credentials are supplied by the foreground operator over a private pipe,
 * held only in memory, never stored in argv/env/files or printed.
 * The required dedicated schema-reader login is deliberately not provisioned
 * by this module. No production migrations, grants or note reads/writes.
 */
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {neon} from "@neondatabase/serverless";
import {RELEASE_DATA_API_URL} from "./neon/production-release.ts";
import {validateProductionOwnerJwt}
  from "./obsidian-m7-production-owner-readonly.ts";

export const M9_SCHEMA_READER_ROLE="naosledge_m9_schema_reader";
const EXPECTED_SQL_SHA256=
  "873e5baf96f4da8173da0d3eb69276314ace6004d5944b9caec84081af21e0d7";
const REQUIRED_TRUE=[
  "notes_present","links_present","notes_rls_enabled","links_rls_enabled",
  "cas_rpc_present","cas_security_invoker","cas_pinned_search_path",
  "authenticated_can_execute","m7_schema_ready",
] as const;
const REQUIRED_FALSE="anonymous_can_execute";
const READER_ROLE_SQL=[
  "SELECT r.rolname AS reader_role, r.rolcanlogin AS can_login,",
  "r.rolsuper AS is_superuser, r.rolcreatedb AS can_create_db_role,",
  "r.rolcreaterole AS can_create_role, r.rolreplication AS can_replicate,",
  "r.rolbypassrls AS bypasses_rls,",
  "current_setting('transaction_read_only')='on' AS transaction_read_only,",
  "pg_has_role(current_user,'pg_write_all_data','member') AS all_data_writer,",
  "has_database_privilege(current_user,current_database(),'CREATE') AS can_create_database,",
  "has_schema_privilege(current_user,'public','CREATE') AS can_create_public,",
  "has_table_privilege(current_user,'public.knowledge_notes','SELECT') AS can_read_notes,",
  "has_table_privilege(current_user,'public.knowledge_notes','INSERT,UPDATE,DELETE') AS can_write_notes,",
  "has_table_privilege(current_user,'public.knowledge_links','SELECT') AS can_read_links,",
  "has_table_privilege(current_user,'public.knowledge_links','INSERT,UPDATE,DELETE') AS can_write_links",
  "FROM pg_catalog.pg_roles AS r WHERE r.rolname=current_user",
].join(" ");
const READER_DENIED=[
  "is_superuser","can_create_db_role","can_create_role","can_replicate",
  "bypasses_rls","all_data_writer","can_create_database",
  "can_create_public","can_read_notes","can_write_notes",
  "can_read_links","can_write_links",
] as const;

function refuse():never{
  throw Error("M9 Production SQL003 runtime readiness unavailable");
}

/**
 * Fail closed unless this is the exact Neon Production branch, database,
 * TLS protocol and a deliberately separate schema-catalog-only login.
 */
export function assertM9SchemaReaderConnection(connection:string):void{
  if(typeof connection!=="string"||connection.length>2048)refuse();
  let value:URL;
  try{value=new URL(connection);}catch{refuse();}
  const approved=new URL(RELEASE_DATA_API_URL).hostname
    .replace(".apirest.",".");
  let user:string;
  try{user=decodeURIComponent(value.username);}catch{refuse();}
  if(!["postgres:","postgresql:"].includes(value.protocol)||
     value.hostname.toLowerCase()!==approved.toLowerCase()||
     (value.port!==""&&value.port!=="5432")||
     value.pathname!=="/neondb"||value.hash||
     user!==M9_SCHEMA_READER_ROLE||
     !value.password||value.password.length<8||
     [...value.searchParams.keys()].length!==1||
     value.searchParams.get("sslmode")!=="require"){
    refuse();
  }
}

/** Check the exact SQL003 status vector. Never accept a bare true or a stub. */
export function verifiedM9Sql003Rows(data:unknown):boolean{
  if(!Array.isArray(data)||data.length!==1)return false;
  const row=data[0];
  if(!row||typeof row!=="object"||Array.isArray(row))return false;
  const result=row as Record<string,unknown>;
  const keys=[...REQUIRED_TRUE,REQUIRED_FALSE];
  if(Object.keys(result).length!==keys.length||
     !Object.keys(result).every(key=>keys.includes(key as typeof keys[number]))){
    return false;
  }
  return REQUIRED_TRUE.every(key=>result[key]===true)&&
    result[REQUIRED_FALSE]===false;
}

/** Require the dedicated PostgreSQL login to be catalog-only, not merely named so. */
export function verifiedM9SchemaReaderRows(data:unknown):boolean{
  if(!Array.isArray(data)||data.length!==1)return false;
  const row=data[0];
  if(!row||typeof row!=="object"||Array.isArray(row))return false;
  const result=row as Record<string,unknown>;
  const keys=["reader_role","can_login","transaction_read_only",
    ...READER_DENIED];
  if(Object.keys(result).length!==keys.length||
     !Object.keys(result).every(key=>
       keys.includes(key as typeof keys[number])))return false;
  return result.reader_role===M9_SCHEMA_READER_ROLE&&
    result.can_login===true&&result.transaction_read_only===true&&
    READER_DENIED.every(key=>result[key]===false);
}

/**
 * The only real-mode SQL003 provider. A failed/missing role, time-out,
 * wrong branch, altered SQL or changed RLS/ACL returns false (no transfer).
 * SELECT is performed within a PostgreSQL READ ONLY transaction.
 */
export function createM9ProductionSql003ReadinessProvider(connection:string){
  assertM9SchemaReaderConnection(connection);
  const sql=neon(connection);
  return async(ownerJwt:string):Promise<boolean>=>{
    try{
      validateProductionOwnerJwt(ownerJwt);
      // GitHub Linux checks out LF; MSI Windows autocrlf may use CRLF.
      // Pin the exact canonical LF source, not platform-specific line endings.
      const statement=(await readFile(new URL(
        "../neon/m7_schema_readiness_readonly.sql",import.meta.url
      ),"utf8")).replace(/\r\n/g,"\n");
      const hash=createHash("sha256").update(statement).digest("hex");
      if(hash!==EXPECTED_SQL_SHA256)return false;
      const [rows,role]=await sql.transaction([
        sql.query(statement,[]),sql.query(READER_ROLE_SQL,[]),
      ],{
        readOnly:true,
        fetchOptions:{signal:AbortSignal.timeout(15_000)},
      });
      return verifiedM9Sql003Rows(rows)&&verifiedM9SchemaReaderRows(role);
    }catch{
      // Deliberately never forward errors, SQL connection strings or JWTs.
      return false;
    }
  };
}
