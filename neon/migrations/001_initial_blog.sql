-- Naosledge / Neon PostgreSQL 18: initial content schema, NOT YET APPLIED.
-- DANGER: Review/approve before running. NEVER run on Supabase or on the
-- existing Neon "production" branch during preflight.
--
-- Preconditions on an explicitly approved ISOLATED Neon test branch:
--   1) Managed Better Auth configured for that branch.
--   2) Neon Data API provisioned for neondb, creating the authenticated and
--      anonymous roles and the auth.user_id() SQL function.
--   3) Confirm current database=neondb and public.posts/blog_admins absent.
--
-- Better Auth's user IDs are TEXT, unlike Supabase's auth.users UUIDs.
-- This schema deliberately does not reference managed neon_auth tables.
-- Do not put provider connection strings or passwords in SQL migrations.
BEGIN;

CREATE TABLE public.blog_admins (
  user_id text PRIMARY KEY CHECK (char_length(user_id) BETWEEN 1 AND 256)
);

CREATE TABLE public.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id text NOT NULL DEFAULT (auth.user_id())
    CHECK (char_length(author_id) BETWEEN 1 AND 256),
  slug text NOT NULL UNIQUE
    CHECK (char_length(slug) BETWEEN 3 AND 120 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  excerpt text NOT NULL DEFAULT '' CHECK (char_length(excerpt) <= 400),
  content_md text NOT NULL DEFAULT '' CHECK (char_length(content_md) <= 200000),
  tags text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT '筆記' CHECK (char_length(category) BETWEEN 1 AND 36),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  learned_on date NOT NULL DEFAULT CURRENT_DATE,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT published_requires_date CHECK (status <> 'published' OR published_at IS NOT NULL),
  CONSTRAINT tags_limit CHECK (coalesce(array_length(tags, 1), 0) <= 12)
);

CREATE INDEX posts_public_idx ON public.posts (updated_at DESC) WHERE status = 'published';
CREATE INDEX posts_updated_idx ON public.posts (updated_at DESC);
CREATE INDEX posts_tags_idx ON public.posts USING gin(tags);

CREATE FUNCTION public.blog_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER blog_posts_touch BEFORE UPDATE ON public.posts
FOR EACH ROW EXECUTE FUNCTION public.blog_touch_updated_at();

-- RLS must be enabled *before* issuing Data API access grants.
ALTER TABLE public.blog_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Neon Data API identities: anonymous / authenticated, NOT Supabase "anon".
REVOKE ALL ON public.blog_admins FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON public.posts FROM PUBLIC, anonymous, authenticated;

GRANT USAGE ON SCHEMA public TO anonymous, authenticated;
GRANT SELECT ON public.blog_admins TO authenticated;
GRANT SELECT ON public.posts TO anonymous, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.posts TO authenticated;
-- No INSERT/UPDATE/DELETE on blog_admins for either Data API role.
-- Admin assignments must be made separately by a trusted project owner.

-- Users can confirm ONLY whether their own ID appears in blog_admins.
CREATE POLICY admin_can_read_self ON public.blog_admins
FOR SELECT TO authenticated USING (user_id = (SELECT auth.user_id()));

-- Anonymous visitors can only see published posts; authenticated users who
-- have no admin row can only see published posts as well.
CREATE POLICY public_published_select ON public.posts
FOR SELECT TO anonymous, authenticated USING (status = 'published');

CREATE POLICY admin_read_all_posts ON public.posts
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.blog_admins AS a
    WHERE a.user_id = (SELECT auth.user_id())
  )
);

CREATE POLICY admin_insert_own_posts ON public.posts
FOR INSERT TO authenticated WITH CHECK (
  author_id = (SELECT auth.user_id())
  AND EXISTS (
    SELECT 1 FROM public.blog_admins AS a
    WHERE a.user_id = (SELECT auth.user_id())
  )
);

CREATE POLICY admin_update_own_posts ON public.posts
FOR UPDATE TO authenticated USING (
  author_id = (SELECT auth.user_id())
  AND EXISTS (
    SELECT 1 FROM public.blog_admins AS a
    WHERE a.user_id = (SELECT auth.user_id())
  )
) WITH CHECK (
  author_id = (SELECT auth.user_id())
  AND EXISTS (
    SELECT 1 FROM public.blog_admins AS a
    WHERE a.user_id = (SELECT auth.user_id())
  )
);

CREATE POLICY admin_delete_own_posts ON public.posts
FOR DELETE TO authenticated USING (
  author_id = (SELECT auth.user_id())
  AND EXISTS (
    SELECT 1 FROM public.blog_admins AS a
    WHERE a.user_id = (SELECT auth.user_id())
  )
);

COMMIT;

-- After migration and RLS tests, use an AUTHORIZED project-owner session to
-- insert the intended owner's ACTUAL Neon Auth user.id, never a guessed ID:
-- INSERT INTO public.blog_admins(user_id) VALUES ('OWNER_USER_ID');
-- Disable public signup and require email verification before real launch.
