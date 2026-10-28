import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

const migration=name=>readFile(new URL("../neon/migrations/"+name,import.meta.url),"utf8");
const check=await readFile(
  new URL("../neon/m7_schema_readiness_readonly.sql",import.meta.url),"utf8"
);
const signature="public.update_knowledge_note_cas_with_links(uuid,text,timestamptz,text[],text,text,text,text,text[],date,text[])";

test("M7 SQL-only production readiness fails closed before SQL003 or with unsafe grants",async(t)=>{
  const db=new PGlite();
  try{
    await db.exec(
      "CREATE SCHEMA auth; CREATE ROLE anonymous NOLOGIN; CREATE ROLE authenticated NOLOGIN; "+
      "CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$ "+
      "SELECT nullif(current_setting('request.jwt.claim.sub', true), '') $$; "+
      "GRANT USAGE ON SCHEMA auth TO anonymous, authenticated; "+
      "GRANT EXECUTE ON FUNCTION auth.user_id() TO anonymous, authenticated;"
    );
    await db.exec(await migration("001_initial_blog.sql"));
    await db.exec(await migration("002_private_knowledge_vault.sql"));
    const inspect=async()=>{
      const result=await db.query(check);
      assert.equal(result.rows.length,1);
      return result.rows[0];
    };
    await t.test("002-only schema is NOT ready, even if the private tables have RLS",async()=>{
      const result=await inspect();
      assert.equal(result.notes_present,true);
      assert.equal(result.links_present,true);
      assert.equal(result.notes_rls_enabled,true);
      assert.equal(result.links_rls_enabled,true);
      assert.equal(result.cas_rpc_present,false);
      assert.equal(result.m7_schema_ready,false);
    });
    await db.exec(await migration("003_m3_wikilink_cas_candidate.sql"));
    await t.test("002+003 in disposable PostgreSQL satisfies the narrow schema gate",async()=>{
      const result=await inspect();
      assert.equal(result.cas_rpc_present,true);
      assert.equal(result.cas_security_invoker,true);
      assert.equal(result.cas_pinned_search_path,true);
      assert.equal(result.authenticated_can_execute,true);
      assert.equal(result.anonymous_can_execute,false);
      assert.equal(result.m7_schema_ready,true);
    });
    await t.test("accidental anonymous EXECUTE grant blocks M7",async()=>{
      await db.exec("BEGIN");
      try{
        await db.exec("GRANT EXECUTE ON FUNCTION "+signature+" TO anonymous");
        const result=await inspect();
        assert.equal(result.anonymous_can_execute,true);
        assert.equal(result.m7_schema_ready,false);
      }finally{await db.exec("ROLLBACK");}
    });
    await t.test("SECURITY DEFINER RPC blocks M7 even with legitimate ACL",async()=>{
      await db.exec("BEGIN");
      try{
        await db.exec("ALTER FUNCTION "+signature+" SECURITY DEFINER");
        const result=await inspect();
        assert.equal(result.cas_security_invoker,false);
        assert.equal(result.m7_schema_ready,false);
      }finally{await db.exec("ROLLBACK");}
    });
    await t.test("missing note RLS blocks M7 even if function is correctly scoped",async()=>{
      await db.exec("BEGIN");
      try{
        await db.exec("ALTER TABLE public.knowledge_notes DISABLE ROW LEVEL SECURITY");
        const result=await inspect();
        assert.equal(result.notes_rls_enabled,false);
        assert.equal(result.m7_schema_ready,false);
      }finally{await db.exec("ROLLBACK");}
    });
    await t.test("an unrestricted function search_path blocks M7",async()=>{
      await db.exec("BEGIN");
      try{
        await db.exec("ALTER FUNCTION "+signature+" RESET search_path");
        const result=await inspect();
        assert.equal(result.cas_pinned_search_path,false);
        assert.equal(result.m7_schema_ready,false);
      }finally{await db.exec("ROLLBACK");}
    });
    await t.test("revoking authenticated EXECUTE blocks M7",async()=>{
      await db.exec("BEGIN");
      try{
        await db.exec("REVOKE EXECUTE ON FUNCTION "+signature+" FROM authenticated");
        const result=await inspect();
        assert.equal(result.authenticated_can_execute,false);
        assert.equal(result.m7_schema_ready,false);
      }finally{await db.exec("ROLLBACK");}
    });
    assert.equal((await inspect()).m7_schema_ready,true);
  }finally{await db.close();}
});
