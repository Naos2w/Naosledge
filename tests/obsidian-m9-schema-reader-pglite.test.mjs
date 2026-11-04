import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";
import {
  M9_SCHEMA_READER_INSPECTION_SQL,verifiedM9SchemaReaderRows,
  verifiedM9Sql003Rows,
} from "../lib/obsidian-m9-production-schema-readiness.ts";

const migration=name=>readFile(new URL(
  "../neon/migrations/"+name,import.meta.url),"utf8");
const schemaGate=()=>readFile(new URL(
  "../neon/m7_schema_readiness_readonly.sql",import.meta.url),"utf8");

/**
 * Real, disposable PostgreSQL SQL execution, not a simulated response row.
 * No Production connection, database login secret or user Markdown involved.
 */
test("M9 dedicated schema reader is catalog-only on a real isolated PostgreSQL engine",async t=>{
  const db=new PGlite();
  const reader="naosledge_m9_schema_reader";
  try{
    await db.exec(
      "CREATE SCHEMA auth; CREATE ROLE anonymous NOLOGIN; "+
      "CREATE ROLE authenticated NOLOGIN; "+
      "CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$ "+
      "SELECT nullif(current_setting('request.jwt.claim.sub', true), '') $$; "+
      "GRANT USAGE ON SCHEMA auth TO anonymous, authenticated; "+
      "GRANT EXECUTE ON FUNCTION auth.user_id() TO anonymous, authenticated;"
    );
    for(const migrationName of [
      "001_initial_blog.sql",
      "002_private_knowledge_vault.sql",
      "003_m3_wikilink_cas_candidate.sql",
    ])await db.exec(await migration(migrationName));
    await db.exec("CREATE ROLE "+reader+" LOGIN; "+
      "GRANT USAGE ON SCHEMA public TO "+reader);

    const inspect=async()=>{
      await db.exec("BEGIN TRANSACTION READ ONLY");
      try{
        await db.exec("SET LOCAL ROLE "+reader);
        const [roles,schema]=await Promise.all([
          db.query(M9_SCHEMA_READER_INSPECTION_SQL),
          db.query(await schemaGate()),
        ]);
        assert.equal(roles.rows.length,1);
        assert.equal(schema.rows.length,1);
        return {role:roles.rows[0],schema:schema.rows[0]};
      }finally{
        await db.exec("ROLLBACK");
      }
    };
    await t.test("the approved login can inspect SQL003 but no note or user relation",async()=>{
      const result=await inspect();
      assert.equal(result.role.reader_role,reader);
      assert.equal(result.role.transaction_read_only,true);
      assert.equal(result.role.any_user_relation_access,false);
      assert.equal(verifiedM9SchemaReaderRows([result.role]),true);
      assert.equal(verifiedM9Sql003Rows([result.schema]),true);
    });
    await t.test("even an unrelated blog SELECT grant disables M9 readiness",async()=>{
      await db.exec("GRANT SELECT ON public.posts TO "+reader);
      const {role}=await inspect();
      assert.equal(role.can_read_notes,false);
      assert.equal(role.can_read_links,false);
      assert.equal(role.any_user_relation_access,true);
      assert.equal(verifiedM9SchemaReaderRows([role]),false);
      await db.exec("REVOKE SELECT ON public.posts FROM "+reader);
    });
    await t.test("access to a non-note sequence also disables M9 readiness",async()=>{
      await db.exec("CREATE SEQUENCE public.m9_test_sequence; "+
        "GRANT USAGE ON SEQUENCE public.m9_test_sequence TO "+reader);
      const {role}=await inspect();
      assert.equal(role.any_user_relation_access,true);
      assert.equal(verifiedM9SchemaReaderRows([role]),false);
      await db.exec("REVOKE USAGE ON SEQUENCE public.m9_test_sequence FROM "+reader);
    });
    await t.test("a powerful inherited PostgreSQL role disables M9 readiness",async()=>{
      await db.exec("GRANT pg_read_all_data TO "+reader);
      const {role}=await inspect();
      assert.equal(role.all_data_reader,true);
      assert.equal(verifiedM9SchemaReaderRows([role]),false);
      await db.exec("REVOKE pg_read_all_data FROM "+reader);
    });
    const result=await inspect();
    assert.equal(verifiedM9SchemaReaderRows([result.role]),true);
  }finally{await db.close();}
});
