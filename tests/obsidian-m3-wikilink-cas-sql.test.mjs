import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

const migration=name=>readFile(new URL("../neon/migrations/"+name,import.meta.url),"utf8");

test("M3 candidate atomic WikiLink CAS is RLS-scoped and rolls back stale/index-mismatched updates",async(t)=>{
  const db=new PGlite();
  try{
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE ROLE anonymous NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE FUNCTION auth.user_id() RETURNS text LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')
      $$;
      GRANT USAGE ON SCHEMA auth TO anonymous, authenticated;
      GRANT EXECUTE ON FUNCTION auth.user_id() TO anonymous, authenticated;
    `);
    for(const name of [
      "001_initial_blog.sql","002_private_knowledge_vault.sql",
      "003_m3_wikilink_cas_candidate.sql",
    ])await db.exec(await migration(name));

    const alice="m3-cas-alice",bob="m3-cas-bob";
    await db.query("INSERT INTO public.blog_admins(user_id) VALUES($1),($2)",[alice,bob]);
    const {rows:[row]}=await db.query(`
      INSERT INTO public.knowledge_notes(owner_id,slug,title,content_md)
      VALUES($1,'cas-links-note','Before','Old [[one-link]]')
      RETURNING id,slug,updated_at
    `,[alice]);
    await db.query(`
      INSERT INTO public.knowledge_links(owner_id,source_note_id,target_key)
      VALUES($1,$2,'one-link')
    `,[alice,row.id]);

    async function as(role,subject,work){
      await db.exec("BEGIN");
      try{
        await db.exec(`SET LOCAL ROLE "${role}"`);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[subject]);
        return await work((sql,params=[])=>db.query(sql,params));
      }finally{await db.exec("ROLLBACK");}
    }
    const rpc=`
      SELECT public.update_knowledge_note_cas_with_links(
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
      ) AS changed_id
    `;
    const parameters=[
      row.id,row.slug,row.updated_at,["one-link"],
      "Updated","","Updated [[new-link]]","筆記",[],"2026-10-26",["new-link"],
    ];

    await t.test("authenticated Owner updates note and outgoing backlinks in one SQL transaction",async()=>{
      await as("authenticated",alice,async query=>{
        const changed=await query(rpc,parameters);
        assert.equal(changed.rows[0].changed_id,row.id);
        const note=await query("SELECT title,content_md FROM public.knowledge_notes WHERE id=$1",[row.id]);
        assert.deepEqual(note.rows,[{title:"Updated",content_md:"Updated [[new-link]]"}]);
        const refs=await query("SELECT target_key FROM public.knowledge_links WHERE source_note_id=$1",[row.id]);
        assert.deepEqual(refs.rows,[{target_key:"new-link"}]);
      });
    });

    await t.test("lost CAS rejects stale row identity without changing backlinks",async()=>{
      await as("authenticated",alice,async query=>{
        await assert.rejects(query(rpc,[
          ...parameters.slice(0,2),"2001-01-01T00:00:00Z",...parameters.slice(3),
        ]),/stale or unauthorized/);
      });
    });

    await t.test("stale or contradictory backlink inventory rejects before note update",async()=>{
      await as("authenticated",alice,async query=>{
        await assert.rejects(query(rpc,[
          ...parameters.slice(0,3),["wrong-link"],...parameters.slice(4),
        ]),/outgoing wiki index changed/);
      });
    });

    await t.test("non-owner and anonymous cannot call an unsafe update",async()=>{
      await as("authenticated",bob,async query=>{
        await assert.rejects(query(rpc,parameters),/(stale or unauthorized|permission denied)/);
      });
      await as("anonymous","",async query=>{
        await assert.rejects(query(rpc,parameters),/permission denied/);
      });
    });

    await t.test("invalid input fails rather than committing a partial new backlink list",async()=>{
      await as("authenticated",alice,async query=>{
        await assert.rejects(query(rpc,[
          ...parameters.slice(0,10),["new-link","new-link"],
        ]),/duplicate wiki reference/);
      });
    });

    // Each role-scoped test rolled back. These source rows remain unchanged.
    const after=await db.query("SELECT title,content_md FROM public.knowledge_notes WHERE id=$1",[row.id]);
    assert.deepEqual(after.rows,[{title:"Before",content_md:"Old [[one-link]]"}]);
    const links=await db.query("SELECT target_key FROM public.knowledge_links WHERE source_note_id=$1",[row.id]);
    assert.deepEqual(links.rows,[{target_key:"one-link"}]);
    const acl=await db.query(`
      SELECT prosecdef AS definer,
        has_function_privilege('anonymous',
          'public.update_knowledge_note_cas_with_links(uuid,text,timestamptz,text[],text,text,text,text,text[],date,text[])',
          'EXECUTE') AS anon_execute
      FROM pg_proc
      WHERE oid='public.update_knowledge_note_cas_with_links(uuid,text,timestamptz,text[],text,text,text,text,text[],date,text[])'::regprocedure
    `);
    assert.deepEqual(acl.rows,[{definer:false,anon_execute:false}]);
  }finally{await db.close();}
});
