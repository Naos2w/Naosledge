import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const sqlUrl = new URL("../neon/migrations/001_initial_blog.sql", import.meta.url);
const sql = await readFile(sqlUrl, "utf8");

test("Neon blog migration enforces public/draft/admin RLS in isolated in-memory PostgreSQL", async (t) => {
  const db = new PGlite();
  try {
    // Neon Data API supplies these roles and this identity function. Mimic
    // only their documented signature in an in-memory database, not Neon.
    await db.exec(`
      CREATE SCHEMA auth;
      CREATE ROLE anonymous NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE FUNCTION auth.user_id() RETURNS text
        LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')
        $$;
      GRANT USAGE ON SCHEMA auth TO anonymous, authenticated;
      GRANT EXECUTE ON FUNCTION auth.user_id() TO anonymous, authenticated;
    `);
    await db.exec(sql);

    const seededId1 = "00000000-0000-4000-8000-000000000001";
    const seededId2 = "00000000-0000-4000-8000-000000000002";
    const seededId3 = "00000000-0000-4000-8000-000000000003";
    await db.query("INSERT INTO public.blog_admins(user_id) VALUES ($1)", ["admin-test-id"]);
    await db.query(
      `INSERT INTO public.posts(id,author_id,slug,title,status,published_at)
        VALUES ($1,'admin-test-id','hello-world','公開文章','published',now()),
               ($2,'admin-test-id','my-secret-draft','只供站長閱讀','draft',NULL),
               ($3,'other-author','other-draft','別人的草稿','draft',NULL)`,
      [seededId1, seededId2, seededId3],
    );

    // Simulate the PostgREST role switch + JWT subject in an isolated SQL tx.
    async function as(role, subject, run) {
      assert.ok(["anonymous", "authenticated"].includes(role));
      await db.exec("BEGIN");
      try {
        await db.exec(`SET LOCAL ROLE "${role}"`);
        await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [subject ?? ""]);
        return await run((statement, params = []) => db.query(statement, params));
      } finally {
        await db.exec("ROLLBACK");
      }
    }

    await t.test("RLS is enabled on all new public tables", async () => {
      const result = await db.query(`
        SELECT relname, relrowsecurity FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relname IN ('posts','blog_admins')
        ORDER BY relname
      `);
      assert.deepEqual(result.rows.map(x=>[x.relname,x.relrowsecurity]), [
        ["blog_admins",true], ["posts",true],
      ]);
    });

    await t.test("anonymous visitors can read published articles only", async () => {
      const rows = await as("anonymous", "", query => query("SELECT slug FROM public.posts ORDER BY slug"));
      assert.deepEqual(rows.rows.map(x=>x.slug), ["hello-world"]);
      await as("anonymous", "", async query => {
        await assert.rejects(query("SELECT user_id FROM public.blog_admins"), /permission denied/);
      });
    });

    await t.test("anonymous visitors cannot insert, update, or delete posts", async () => {
      await as("anonymous", "", async query => {
        await assert.rejects(query("INSERT INTO public.posts(author_id,slug,title) VALUES('attacker','injected-note','bad')"), /permission denied/);
      });
      await as("anonymous", "", async query => {
        await assert.rejects(query("DELETE FROM public.posts WHERE slug='hello-world'"), /permission denied/);
      });
    });

    await t.test("non-admin signed in user only reads public data", async () => {
      const rows = await as("authenticated", "reader-test-id", query =>
        query("SELECT slug FROM public.posts ORDER BY slug"));
      assert.deepEqual(rows.rows.map(x=>x.slug), ["hello-world"]);
      const adminRows = await as("authenticated", "reader-test-id", query =>
        query("SELECT user_id FROM public.blog_admins"));
      assert.equal(adminRows.rows.length, 0);
    });

    await t.test("non-admin users cannot create or modify public content", async () => {
      await as("authenticated", "reader-test-id", async query => {
        await assert.rejects(query("INSERT INTO public.posts(slug,title) VALUES('reader-post','unapproved')"), /row-level security/);
      });
      const result = await as("authenticated", "reader-test-id", query =>
        query("UPDATE public.posts SET title='hacked' WHERE slug='hello-world' RETURNING id"));
      assert.equal(result.rows.length, 0);
    });

    await t.test("admin can see own drafts, insert own articles and update", async () => {
      const rows = await as("authenticated", "admin-test-id", query =>
        query("SELECT slug FROM public.posts ORDER BY slug"));
      assert.deepEqual(rows.rows.map(x=>x.slug), ["hello-world","my-secret-draft","other-draft"]);
      const inserted = await as("authenticated", "admin-test-id", query => query(
        `INSERT INTO public.posts(slug,title,status) VALUES ('new-note','test','draft')
        RETURNING author_id, status`,
      ));
      assert.deepEqual(inserted.rows, [{author_id:"admin-test-id",status:"draft"}]);
      // Transactions intentionally roll back: no permanent test changes.
      const renamed = await as("authenticated", "admin-test-id", query =>
        query("UPDATE public.posts SET title='edited' WHERE slug='my-secret-draft' RETURNING title"));
      assert.deepEqual(renamed.rows.map(x=>x.title), ["edited"]);
    });

    await t.test("admin cannot reassign another author's draft", async () => {
      const rows = await as("authenticated", "admin-test-id", query =>
        query("UPDATE public.posts SET author_id='admin-test-id' WHERE slug='other-draft' RETURNING id"));
      assert.equal(rows.rows.length, 0, "Owner-only UPDATE USING policy blocks the reassignment");
    });

    await t.test("admin cannot change author_id to impersonate a user", async () => {
      await as("authenticated", "admin-test-id", async query => {
        await assert.rejects(
          query("UPDATE public.posts SET author_id='reader-test-id' WHERE slug='my-secret-draft'"),
          /row-level security/,
        );
      });
    });

    await t.test("neither anonymous nor authenticated role may assign admins", async () => {
      await as("authenticated", "admin-test-id", async query => {
        await assert.rejects(
          query("INSERT INTO public.blog_admins(user_id) VALUES ('reader-test-id')"),
          /permission denied/,
        );
      });
    });

    await t.test("schema denies invalid or overlarge published content", async () => {
      await assert.rejects(
        db.query("INSERT INTO public.posts(author_id,slug,title,status,published_at) VALUES('admin-test-id','invalid-published','no','published',null)"),
        /published_requires_date/,
      );
      await assert.rejects(
        db.query("INSERT INTO public.posts(author_id,slug,title,content_md) VALUES('admin-test-id','too-large','no',$1)", ["x".repeat(200_001)]),
        /content_md_check/,
      );
    });
  } finally {
    await db.close();
  }
});
