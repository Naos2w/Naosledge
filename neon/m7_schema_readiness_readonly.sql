-- M7 read-only metadata gate. Run independently on each approved Neon branch.
-- SELECT only: no personal note content, no migrations, no grant changes,
-- and no authority to activate Obsidian <-> Production synchronization.
-- This proves a narrowly scoped schema/ACL shape, not live Owner-RLS or
-- approval to write real notes.
WITH rpc AS (
  SELECT to_regprocedure(
    'public.update_knowledge_note_cas_with_links(uuid,text,timestamptz,text[],text,text,text,text,text[],date,text[])'
  ) AS signature
),
checks AS (
  SELECT
    to_regclass('public.knowledge_notes') IS NOT NULL AS notes_present,
    to_regclass('public.knowledge_links') IS NOT NULL AS links_present,
    COALESCE((
      SELECT c.relrowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid=to_regclass('public.knowledge_notes')
    ),false) AS notes_rls_enabled,
    COALESCE((
      SELECT c.relrowsecurity FROM pg_catalog.pg_class c
      WHERE c.oid=to_regclass('public.knowledge_links')
    ),false) AS links_rls_enabled,
    rpc.signature IS NOT NULL AS cas_rpc_present,
    COALESCE((
      SELECT NOT p.prosecdef FROM pg_catalog.pg_proc p
      WHERE p.oid=rpc.signature
    ),false) AS cas_security_invoker,
    COALESCE((
      SELECT p.proconfig && ARRAY['search_path=""','search_path=']::text[]
      FROM pg_catalog.pg_proc p WHERE p.oid=rpc.signature
    ),false) AS cas_pinned_search_path,
    COALESCE(
      pg_catalog.has_function_privilege('authenticated',rpc.signature::oid,'EXECUTE'),
      false
    ) AS authenticated_can_execute,
    COALESCE(
      pg_catalog.has_function_privilege('anonymous',rpc.signature::oid,'EXECUTE'),
      false
    ) AS anonymous_can_execute
  FROM rpc
)
SELECT checks.*,
  (
    notes_present AND links_present AND notes_rls_enabled AND links_rls_enabled
    AND cas_rpc_present AND cas_security_invoker AND cas_pinned_search_path
    AND authenticated_can_execute AND NOT anonymous_can_execute
  ) AS m7_schema_ready
FROM checks;
