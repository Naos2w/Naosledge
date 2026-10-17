import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PGlite} from "@electric-sql/pglite";

const initial = await readFile(new URL("../neon/migrations/001_initial_blog.sql", import.meta.url), "utf8");
const vault = await readFile(new URL("../neon/migrations/002_private_knowledge_vault.sql", import.meta.url), "utf8");

test("P1/P2 private vault migration isolates knowledge, links, publications and search", async (t) => {
  const db = new PGlite();
  try {
    // Mirrors role/function signatures, with synthetic identities only.
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
    await db.exec(initial);
    await db.exec(vault);

    const alice="alice-synthetic-id", bob="bob-synthetic-id", stranger="reader-synthetic-id";
    await db.query("INSERT INTO public.blog_admins(user_id) VALUES ($1),($2)",[alice,bob]);
    const a=(await db.query(`
      INSERT INTO public.knowledge_notes(owner_id,slug,title,summary,content_md,tags)
      VALUES ($1,'neon-auth','Neon Auth','登入設計','只供 Alice 的神經元秘密',ARRAY['身分驗證']),
             ($1,'rls-security','RLS 權限','資料庫隔離','## RLS 與 JWT 筆記',ARRAY['PostgreSQL'])
      RETURNING id,slug
    `,[alice])).rows;
    const b=(await db.query(`
      INSERT INTO public.knowledge_notes(owner_id,slug,title,summary,content_md)
      VALUES ($1,'my-secret','Bob 的私密知識','自己的網絡','Bob 的絕密')
      RETURNING id
    `,[bob])).rows[0];
    const source=a.find(n=>n.slug==="rls-security").id;
    const target=a.find(n=>n.slug==="neon-auth").id;
    await db.query("INSERT INTO public.knowledge_links(owner_id,source_note_id,target_key) VALUES ($1,$2,'neon-auth'),($1,$2,'missing-future-note')",[alice,source]);

    async function as(role,sub,task) {
      await db.exec("BEGIN");
      try {
        await db.exec(`SET LOCAL ROLE "${role}"`);
        await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[sub||""]);
        // Savepoint per statement permits multiple expected SQL failures in one
        // role-scoped transaction without poisoning the rest of the test.
        let serial=0;
        return await task(async (sql,params=[])=>{
          const point=`statement_${++serial}`;
          await db.exec(`SAVEPOINT ${point}`);
          try {
            const result=await db.query(sql,params);
            await db.exec(`RELEASE SAVEPOINT ${point}`);
            return result;
          } catch(err) {
            await db.exec(`ROLLBACK TO SAVEPOINT ${point}`);
            await db.exec(`RELEASE SAVEPOINT ${point}`);
            throw err;
          }
        });
      } finally {
        await db.exec("ROLLBACK");
      }
    }

    await t.test("all private tables are RLS-protected",async()=>{
      const {rows}=await db.query(`
        SELECT relname, relrowsecurity FROM pg_class
        WHERE relnamespace='public'::regnamespace
          AND relname IN ('knowledge_notes','knowledge_links','knowledge_publication_sources')
        ORDER BY relname
      `);
      assert.deepEqual(rows.map(x=>[x.relname,x.relrowsecurity]),[
        ["knowledge_links",true],["knowledge_notes",true],["knowledge_publication_sources",true],
      ]);
      const indexes=await db.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='knowledge_notes'");
      assert.ok(indexes.rows.map(r=>r.indexname).includes("knowledge_notes_fts_idx"));
    });

    await t.test("limited verified JWT helper is definer-only and unavailable to anonymous",async()=>{
      const {rows:helper}=await db.query(`
        SELECT prosecdef AS security_definer,
          has_function_privilege('authenticated','public.vault_current_user_id()','EXECUTE') AS member_execute,
          has_function_privilege('anonymous','public.vault_current_user_id()','EXECUTE') AS anonymous_execute
        FROM pg_proc WHERE oid='public.vault_current_user_id()'::regprocedure
      `);
      assert.deepEqual(helper,[{
        security_definer:true,member_execute:true,anonymous_execute:false,
      }]);
      const member=await as("authenticated",alice,query=>query("SELECT public.vault_current_user_id() AS user_id"));
      assert.equal(member.rows[0].user_id,alice);
      await as("anonymous","",query=>assert.rejects(
        query("SELECT public.vault_current_user_id()"),/permission denied/,
      ));
    });

    await t.test("anonymous access cannot read private rows, indexes or call RPCs",async()=>{
      await as("anonymous","",async query=>{
        for(const table of ["knowledge_notes","knowledge_links","knowledge_publication_sources"]) {
          await assert.rejects(query(`SELECT * FROM public.${table}`),/permission denied/);
        }
        await assert.rejects(query("SELECT * FROM public.search_knowledge_notes('秘密',50)"),/permission denied/);
        await assert.rejects(query("SELECT public.is_knowledge_owner()"),/permission denied/);
        await assert.rejects(query("INSERT INTO public.knowledge_notes(slug,title) VALUES('steal','bad')"),/permission denied/);
      });
    });

    await t.test("non-admin signed-in users cannot view or create any private notes",async()=>{
      await as("authenticated",stranger,async query=>{
        const r=await query("SELECT slug FROM public.knowledge_notes");
        assert.deepEqual(r.rows,[]);
        const links=await query("SELECT target_key FROM public.knowledge_links");
        assert.deepEqual(links.rows,[]);
        const s=await query("SELECT slug FROM public.search_knowledge_notes('秘密',50)");
        assert.equal(s.rows.length,0);
        await assert.rejects(query("INSERT INTO public.knowledge_notes(slug,title) VALUES('hacked','bad')"),/row-level security/);
        await assert.rejects(query("SELECT public.save_knowledge_note(null,'Hi','hi-test','','','筆記',ARRAY[]::text[],current_date,ARRAY[]::text[])"),/permission denied/);
      });
    });

    await t.test("owner isolation applies even between two authorized admins",async()=>{
      const rows=await as("authenticated",alice,query=>query("SELECT slug FROM public.knowledge_notes ORDER BY slug"));
      assert.deepEqual(rows.rows.map(x=>x.slug),["neon-auth","rls-security"]);
      const bobNotes=await as("authenticated",bob,query=>query("SELECT slug FROM public.knowledge_notes"));
      assert.deepEqual(bobNotes.rows.map(x=>x.slug),["my-secret"]);
      await as("authenticated",bob,async query=>{
        const r=await query("UPDATE public.knowledge_notes SET title='STOLEN' WHERE id=$1 RETURNING id",[source]);
        assert.equal(r.rows.length,0);
        const del=await query("DELETE FROM public.knowledge_notes WHERE id=$1 RETURNING id",[source]);
        assert.equal(del.rows.length,0);
        await assert.rejects(query(
          "INSERT INTO public.knowledge_links(owner_id,source_note_id,target_key) VALUES ($1,$2,'neon-auth')",
          [bob,source],
        ),/(foreign key|permission denied|row-level security)/);
        await assert.rejects(query(
          "UPDATE public.knowledge_notes SET owner_id=$1 WHERE id=$2",
          [alice,b.id],
        ),/row-level security/);
      });
    });

    await t.test("atomic save replaces wiki references and enforces actor ownership",async()=>{
      await as("authenticated",alice,async query=>{
        const created=await query(
          "SELECT public.save_knowledge_note(NULL,$1,$2,$3,$4,$5,$6,$7,$8) AS note_id",
          ["TypeScript","typescript","索引","## 筆記","技術",["TS"],"2026-10-17",["neon-auth","RLS 權限","neon-auth"]],
        );
        const id=created.rows[0].note_id;
        assert.match(id,/^[a-f0-9-]{36}$/);
        let backlinks=await query("SELECT target_key FROM public.knowledge_links WHERE source_note_id=$1 ORDER BY target_key",[id]);
        assert.deepEqual(backlinks.rows.map(x=>x.target_key),["neon-auth","rls 權限"]);
        await query(
          "SELECT public.save_knowledge_note($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [id,"TypeScript 更新","typescript","新摘要","[[neon-auth]]","技術",["TS"],"2026-10-17",["neon-auth"]],
        );
        backlinks=await query("SELECT target_key FROM public.knowledge_links WHERE source_note_id=$1",[id]);
        assert.deepEqual(backlinks.rows.map(x=>x.target_key),["neon-auth"]);
        const note=await query("SELECT title FROM public.knowledge_notes WHERE id=$1",[id]);
        assert.equal(note.rows[0].title,"TypeScript 更新");
        await assert.rejects(
          query("SELECT public.save_knowledge_note($1,'bad','hacker','','','筆記',ARRAY[]::text[],current_date,ARRAY[]::text[])",[b.id]),
          /not found or not owned/,
        );
      });
      await as("authenticated",bob,async query=>{
        await assert.rejects(query(
          "SELECT public.save_knowledge_note(null,'Too many','too-many','','','筆記',ARRAY[]::text[],current_date,$1)",
          [Array.from({length:81},(_,i)=>`linked-${i}`)],
        ),/too many/);
        const check=await query("SELECT COUNT(*)::int AS n FROM public.knowledge_notes");
        assert.equal(check.rows[0].n,1,"Failed RPC must not persist a partial note");
      });
    });

    await t.test("search isolates owners; indexes Latin; Chinese substring searches work",async()=>{
      const en=await as("authenticated",alice,query=>query(
        "SELECT slug FROM public.search_knowledge_notes('RLS',50) ORDER BY slug"));
      assert.deepEqual(en.rows.map(x=>x.slug),["rls-security"]);
      const zh=await as("authenticated",alice,query=>query(
        "SELECT slug FROM public.search_knowledge_notes('神經元',50)"));
      assert.deepEqual(zh.rows.map(x=>x.slug),["neon-auth"]);
      const tag=await as("authenticated",alice,query=>query(
        "SELECT slug FROM public.search_knowledge_notes('PostgreSQL',50)"));
      assert.deepEqual(tag.rows.map(x=>x.slug),["rls-security"]);
      const noLeak=await as("authenticated",bob,query=>query(
        "SELECT slug FROM public.search_knowledge_notes('神經元',50)"));
      assert.equal(noLeak.rows.length,0);
    });

    await t.test("links and publications are private, not auto-exposed with public posts",async()=>{
      await db.query(
        "INSERT INTO public.posts(author_id,slug,title,status,published_at,content_md) VALUES ($1,'curated-public','公開摘要','published',now(),'經審查的公開文字')",
        [alice],
      );
      const post=(await db.query("SELECT id FROM public.posts WHERE slug='curated-public'")).rows[0].id;
      await db.query(
        "INSERT INTO public.knowledge_publication_sources(owner_id,note_id,post_id) VALUES ($1,$2,$3)",
        [alice,target,post],
      );
      await as("authenticated",alice,async query=>{
        const backlinks=await query("SELECT target_key FROM public.knowledge_links WHERE source_note_id=$1 ORDER BY target_key",[source]);
        assert.deepEqual(backlinks.rows.map(x=>x.target_key),["missing-future-note","neon-auth"]);
        const sources=await query("SELECT note_id FROM public.knowledge_publication_sources");
        assert.deepEqual(sources.rows.map(x=>x.note_id),[target]);
      });
      const pub=await as("anonymous","",query=>query("SELECT slug,content_md FROM public.posts WHERE slug='curated-public'"));
      assert.deepEqual(pub.rows,[{slug:"curated-public",content_md:"經審查的公開文字"}]);
      await as("anonymous","",async query=>{
        await assert.rejects(query("SELECT * FROM public.knowledge_publication_sources"),/permission denied/);
        await assert.rejects(query("SELECT * FROM public.knowledge_links"),/permission denied/);
      });
      const sourceOther=await as("authenticated",bob,query=>query("SELECT * FROM public.knowledge_publication_sources"));
      assert.equal(sourceOther.rows.length,0);
    });

    await t.test("copying to publication creates only an unpublished draft snapshot",async()=>{
      await as("authenticated",alice,async query=>{
        const r=await query(
          "SELECT public.create_knowledge_public_draft($1,$2,$3) AS post_id",
          [target,"draft-copy-of-neon-auth","經過確認的公開摘要"],
        );
        const id=r.rows[0].post_id;
        const copied=await query("SELECT status, content_md, published_at, author_id FROM public.posts WHERE id=$1",[id]);
        assert.deepEqual(copied.rows,[{
          status:"draft",content_md:"經過確認的公開摘要",
          published_at:null,author_id:alice,
        }]);
        const mapped=await query("SELECT note_id FROM public.knowledge_publication_sources WHERE post_id=$1",[id]);
        assert.deepEqual(mapped.rows,[{note_id:target}]);
      });
      await as("authenticated",bob,async query=>{
        await assert.rejects(
          query("SELECT public.create_knowledge_public_draft($1,'unauthorized-copy','no')",[target]),
          /not found or not owned/,
        );
      });
      await as("anonymous","",async query=>{
        await assert.rejects(
          query("SELECT public.create_knowledge_public_draft($1,'anonymous-copy','no')",[target]),
          /permission denied/,
        );
      });
    });

  } finally { await db.close(); }
});
