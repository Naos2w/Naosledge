-- Naosledge Second Brain P1/P2: ADDITIVE private-only schema.
-- Proposal only. DO NOT APPLY to Neon Production or existing Supabase.
-- Requires 001_initial_blog.sql, managed Better Auth, auth.user_id(), and
-- Neon Data API anonymous/authenticated roles; no migration permission implied.
-- Existing public.posts (and its publishing behavior) is not changed.
BEGIN;

CREATE TABLE public.knowledge_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL DEFAULT (auth.user_id())
    CHECK (char_length(owner_id) BETWEEN 1 AND 256),
  slug text NOT NULL
    CHECK (char_length(slug) BETWEEN 3 AND 120 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 400),
  content_md text NOT NULL DEFAULT '' CHECK (char_length(content_md) <= 200000),
  category text NOT NULL DEFAULT '筆記' CHECK (char_length(category) BETWEEN 1 AND 36),
  tags text[] NOT NULL DEFAULT '{}' CHECK (coalesce(array_length(tags, 1), 0) <= 12),
  learned_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Simple PostgreSQL FTS indexes Latin/space-delimited words.
  -- Chinese substring fallback in search_knowledge_notes works without
  -- pg_trgm; do not pretend this is an indexed Chinese tokenizer.
  search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, title || ' ' || summary || ' ' || content_md)
  ) STORED,
  CONSTRAINT knowledge_notes_owner_slug_key UNIQUE(owner_id, slug),
  CONSTRAINT knowledge_notes_owner_id_key UNIQUE(owner_id, id)
);

CREATE INDEX knowledge_notes_recent_idx ON public.knowledge_notes(owner_id, updated_at DESC);
CREATE INDEX knowledge_notes_fts_idx ON public.knowledge_notes USING gin(search_document);
CREATE INDEX knowledge_notes_tags_idx ON public.knowledge_notes USING gin(tags);
CREATE TRIGGER knowledge_notes_touch BEFORE UPDATE ON public.knowledge_notes
FOR EACH ROW EXECUTE FUNCTION public.blog_touch_updated_at();

-- "target_key" contains a normalized [[slug]], [[title]] or [[slug|label]].
-- It is intentionally not an FK: unresolved links become live when a matching
-- private note is created later, and target note identities are never public.
CREATE TABLE public.knowledge_links (
  owner_id text NOT NULL DEFAULT (auth.user_id())
    CHECK (char_length(owner_id) BETWEEN 1 AND 256),
  source_note_id uuid NOT NULL,
  target_key text NOT NULL
    CHECK (char_length(target_key) BETWEEN 1 AND 160 AND target_key = lower(btrim(target_key))),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, source_note_id, target_key),
  CONSTRAINT knowledge_links_source_owner_fk
    FOREIGN KEY (owner_id, source_note_id)
    REFERENCES public.knowledge_notes(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX knowledge_links_backlinks_idx ON public.knowledge_links(owner_id, target_key);

-- Future explicit publishing map: PRIVATE ONLY, never sent to public clients.
-- A curated public post is a separate snapshot in existing public.posts.
CREATE TABLE public.knowledge_publication_sources (
  owner_id text NOT NULL DEFAULT (auth.user_id())
    CHECK (char_length(owner_id) BETWEEN 1 AND 256),
  note_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id, note_id, post_id),
  FOREIGN KEY (owner_id, note_id)
    REFERENCES public.knowledge_notes(owner_id, id) ON DELETE CASCADE
);

CREATE FUNCTION public.is_knowledge_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blog_admins
    WHERE user_id = (SELECT auth.user_id())
  );
$$;

-- RLS is enabled before any Data API permission is granted. The public role
-- cannot discover note IDs, search terms, relationships, publication mapping,
-- or drafts, even if a source post is publicly published.
ALTER TABLE public.knowledge_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_publication_sources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.knowledge_notes FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON public.knowledge_links FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON public.knowledge_publication_sources FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON FUNCTION public.is_knowledge_owner() FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.is_knowledge_owner() TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_links TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.knowledge_publication_sources TO authenticated;

CREATE POLICY knowledge_notes_select_own ON public.knowledge_notes
FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_notes_insert_own ON public.knowledge_notes
FOR INSERT TO authenticated
WITH CHECK (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_notes_update_own ON public.knowledge_notes
FOR UPDATE TO authenticated
USING (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()))
WITH CHECK (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_notes_delete_own ON public.knowledge_notes
FOR DELETE TO authenticated
USING (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_links_select_own ON public.knowledge_links
FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_links_insert_own ON public.knowledge_links
FOR INSERT TO authenticated
WITH CHECK (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_links_delete_own ON public.knowledge_links
FOR DELETE TO authenticated
USING (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_publications_select_own ON public.knowledge_publication_sources
FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_publications_insert_own ON public.knowledge_publication_sources
FOR INSERT TO authenticated
WITH CHECK (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

CREATE POLICY knowledge_publications_delete_own ON public.knowledge_publication_sources
FOR DELETE TO authenticated
USING (owner_id = (SELECT auth.user_id()) AND (SELECT public.is_knowledge_owner()));

-- Save the note and its backlinks atomically. SECURITY INVOKER means the
-- member's actual Neon JWT and RLS are checked for every write.
CREATE FUNCTION public.save_knowledge_note(
  p_id uuid,
  p_title text,
  p_slug text,
  p_summary text,
  p_content_md text,
  p_category text,
  p_tags text[],
  p_learned_on date,
  p_links text[]
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  note_id uuid;
BEGIN
  IF NOT (SELECT public.is_knowledge_owner()) OR auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'knowledge note permission denied' USING ERRCODE = '42501';
  END IF;
  IF coalesce(array_length(p_links, 1), 0) > 80 THEN
    RAISE EXCEPTION 'too many wiki references' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.knowledge_notes
      (owner_id, title, slug, summary, content_md, category, tags, learned_on)
    VALUES
      (auth.user_id(), p_title, p_slug, p_summary, p_content_md, p_category, p_tags, p_learned_on)
    RETURNING id INTO note_id;
  ELSE
    UPDATE public.knowledge_notes
    SET title = p_title, slug = p_slug, summary = p_summary,
        content_md = p_content_md, category = p_category, tags = p_tags,
        learned_on = p_learned_on
    WHERE id = p_id AND owner_id = (SELECT auth.user_id())
    RETURNING id INTO note_id;
    IF note_id IS NULL THEN
      RAISE EXCEPTION 'knowledge note not found or not owned' USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.knowledge_links
  WHERE owner_id = (SELECT auth.user_id()) AND source_note_id = note_id;
  INSERT INTO public.knowledge_links(owner_id, source_note_id, target_key)
  SELECT auth.user_id(), note_id, lower(btrim(key))
  FROM unnest(coalesce(p_links, ARRAY[]::text[])) AS x(key)
  WHERE key IS NOT NULL AND char_length(btrim(key)) BETWEEN 1 AND 160
  ON CONFLICT DO NOTHING;
  RETURN note_id;
END;
$$;

-- Parameterized search with GIN-backed PostgreSQL FTS and a Unicode substring
-- fallback for Chinese. Result rows are still enforced by RLS.
CREATE FUNCTION public.search_knowledge_notes(
  p_query text,
  p_limit integer DEFAULT 50
) RETURNS SETOF public.knowledge_notes
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT n.*
  FROM public.knowledge_notes AS n
  WHERE n.owner_id = (SELECT auth.user_id())
    AND (
      NULLIF(btrim(left(coalesce(p_query, ''), 120)), '') IS NULL
      OR n.search_document @@ websearch_to_tsquery('simple'::regconfig, left(p_query, 120))
      OR strpos(lower(n.title), lower(left(p_query, 120))) > 0
      OR strpos(lower(n.summary), lower(left(p_query, 120))) > 0
      OR strpos(lower(n.content_md), lower(left(p_query, 120))) > 0
      OR EXISTS (
        SELECT 1 FROM unnest(n.tags) AS tag
        WHERE strpos(lower(tag), lower(left(p_query, 120))) > 0
      )
    )
  ORDER BY n.updated_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 50), 100));
$$;

-- Explicit publishing step one: make a separate, PRIVATE draft snapshot.
-- This never sets posts.status=published and never auto-syncs later edits.
-- The owner must review the draft in the existing Studio and explicitly publish.
CREATE FUNCTION public.create_knowledge_public_draft(
  p_note_id uuid,
  p_public_slug text,
  p_review_content_md text
) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  source_note public.knowledge_notes%ROWTYPE;
  created_post uuid;
BEGIN
  IF NOT (SELECT public.is_knowledge_owner()) OR auth.user_id() IS NULL THEN
    RAISE EXCEPTION 'knowledge publishing permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT n.* INTO source_note FROM public.knowledge_notes AS n
  WHERE n.id = p_note_id AND n.owner_id = (SELECT auth.user_id());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'private source note not found or not owned' USING ERRCODE = '42501';
  END IF;
  IF p_review_content_md IS NULL OR char_length(p_review_content_md) > 200000 THEN
    RAISE EXCEPTION 'invalid review content' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.posts(
    author_id, slug, title, excerpt, content_md, category, tags,
    status, learned_on, published_at
  ) VALUES (
    auth.user_id(), p_public_slug, source_note.title, source_note.summary,
    p_review_content_md, source_note.category, source_note.tags,
    'draft', source_note.learned_on, NULL
  ) RETURNING id INTO created_post;
  INSERT INTO public.knowledge_publication_sources(owner_id,note_id,post_id)
  VALUES (auth.user_id(), source_note.id, created_post);
  RETURN created_post;
END;
$$;

REVOKE ALL ON FUNCTION public.save_knowledge_note(uuid,text,text,text,text,text,text[],date,text[])
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.save_knowledge_note(uuid,text,text,text,text,text,text[],date,text[])
  TO authenticated;
REVOKE ALL ON FUNCTION public.search_knowledge_notes(text,integer)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge_notes(text,integer)
  TO authenticated;
REVOKE ALL ON FUNCTION public.create_knowledge_public_draft(uuid,text,text)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.create_knowledge_public_draft(uuid,text,text)
  TO authenticated;

COMMIT;
