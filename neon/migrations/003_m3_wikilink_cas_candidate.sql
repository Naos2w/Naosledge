-- M3 additive Owner-RLS CAS + WikiLink update RPC.
-- Installed and verified in Neon Integration Sandbox and, after a separate
-- explicit Owner approval, in Production on 2026-10-28. DO NOT re-run on
-- either branch; this is an audit reference, not an auto-apply migration.
-- The existing 002 functions are unchanged.
-- A PostgREST call is one PostgreSQL transaction: note and outgoing index
-- either both commit, or both roll back on a lost CAS or invalid link set.
BEGIN;

CREATE FUNCTION public.update_knowledge_note_cas_with_links(
  p_id uuid,
  p_slug text,
  p_expected_updated_at timestamptz,
  p_expected_links text[],
  p_title text,
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
  actor text;
  locked_id uuid;
  stored_links text[];
  expected_links text[];
  new_links text[];
BEGIN
  actor := public.vault_current_user_id();
  IF actor IS NULL OR NOT (SELECT public.is_knowledge_owner()) THEN
    RAISE EXCEPTION 'knowledge note permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_slug IS NULL OR p_expected_updated_at IS NULL OR
     p_expected_links IS NULL OR p_links IS NULL OR
     cardinality(p_expected_links) > 80 OR cardinality(p_links) > 80 THEN
    RAISE EXCEPTION 'invalid conditional update' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_expected_links || p_links) AS ref(k)
    WHERE k IS NULL OR length(k) NOT BETWEEN 1 AND 160
      OR k <> lower(btrim(k))
  ) THEN
    RAISE EXCEPTION 'noncanonical wiki reference' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO expected_links
    FROM (SELECT DISTINCT k FROM unnest(p_expected_links) AS ref(k)) refs;
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[])
    INTO new_links
    FROM (SELECT DISTINCT k FROM unnest(p_links) AS ref(k)) refs;
  IF cardinality(expected_links) <> cardinality(p_expected_links)
     OR cardinality(new_links) <> cardinality(p_links) THEN
    RAISE EXCEPTION 'duplicate wiki reference' USING ERRCODE = '22023';
  END IF;

  -- Lock the same note row whose approved id, slug and precise timestamp
  -- were witnessed by the caller. No blind save_knowledge_note(p_id) update.
  SELECT n.id INTO locked_id
  FROM public.knowledge_notes AS n
  WHERE n.id = p_id AND n.owner_id = actor AND n.slug = p_slug
    AND n.updated_at = p_expected_updated_at
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale or unauthorized knowledge note' USING ERRCODE = '40001';
  END IF;

  SELECT coalesce(array_agg(l.target_key ORDER BY l.target_key), ARRAY[]::text[])
    INTO stored_links
  FROM public.knowledge_links AS l
  WHERE l.owner_id = actor AND l.source_note_id = locked_id;
  IF stored_links IS DISTINCT FROM expected_links THEN
    RAISE EXCEPTION 'outgoing wiki index changed' USING ERRCODE = '40001';
  END IF;

  UPDATE public.knowledge_notes
  SET title = p_title, summary = p_summary, content_md = p_content_md,
      category = p_category, tags = p_tags, learned_on = p_learned_on
  WHERE id = locked_id AND owner_id = actor AND slug = p_slug
    AND updated_at = p_expected_updated_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale knowledge note' USING ERRCODE = '40001';
  END IF;

  DELETE FROM public.knowledge_links
  WHERE owner_id = actor AND source_note_id = locked_id;
  INSERT INTO public.knowledge_links(owner_id, source_note_id, target_key)
  SELECT actor, locked_id, ref.k FROM unnest(new_links) AS ref(k);
  RETURN locked_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_knowledge_note_cas_with_links(
  uuid,text,timestamptz,text[],text,text,text,text,text[],date,text[]
) FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.update_knowledge_note_cas_with_links(
  uuid,text,timestamptz,text[],text,text,text,text,text[],date,text[]
) TO authenticated;

COMMIT;
