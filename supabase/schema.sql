-- Naosledge v1 setup, run once in a NEW, dedicated Supabase project.
-- Create the admin account via Supabase Authentication > Users FIRST;
-- then replace the placeholder at the bottom with that account's UUID.
-- Never use the SQL editor on a shared/production DB without review.

create table if not exists public.blog_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references auth.users(id),
  slug text not null unique check (char_length(slug) between 3 and 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  excerpt text not null default '' check (char_length(excerpt) <= 400),
  content_md text not null default '',
  tags text[] not null default '{}',
  category text not null default '筆記' check (char_length(category) between 1 and 36),
  status text not null default 'draft' check (status in ('draft', 'published')),
  learned_on date not null default current_date,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint published_requires_date check (status <> 'published' or published_at is not null),
  constraint tags_limit check (coalesce(array_length(tags,1),0) <= 12)
);

create index if not exists posts_public_idx on public.posts (updated_at desc) where status = 'published';
create index if not exists posts_updated_idx on public.posts (updated_at desc);
create index if not exists posts_tags_idx on public.posts using gin(tags);

create or replace function public.blog_touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists blog_posts_touch on public.posts;
create trigger blog_posts_touch before update on public.posts
for each row execute function public.blog_touch_updated_at();

alter table public.blog_admins enable row level security;
alter table public.posts enable row level security;

revoke all on public.blog_admins from anon, authenticated;
revoke all on public.posts from anon, authenticated;
grant select on public.blog_admins to authenticated;
grant select on public.posts to anon, authenticated;
grant insert, update, delete on public.posts to authenticated;

-- Readers cannot enumerate admin IDs; admins may look up ONLY their own ID.
create policy "admin_can_read_self" on public.blog_admins
for select to authenticated using (user_id = (select auth.uid()));

-- Public reads only published posts; admin reads all including drafts.
-- Separate policies matter: anon must not query blog_admins (no SELECT grant).
create policy "public_published_select" on public.posts
for select to anon, authenticated using (status = 'published');

create policy "admin_read_all_posts" on public.posts
for select to authenticated using (
  exists (select 1 from public.blog_admins a where a.user_id = (select auth.uid()))
);

create policy "admin_insert_own_posts" on public.posts
for insert to authenticated with check (
  author_id = (select auth.uid()) and exists (
    select 1 from public.blog_admins a where a.user_id = (select auth.uid())
  )
);

create policy "admin_update_own_posts" on public.posts
for update to authenticated using (
  author_id = (select auth.uid()) and exists (
    select 1 from public.blog_admins a where a.user_id = (select auth.uid())
  )
) with check (
  author_id = (select auth.uid()) and exists (
    select 1 from public.blog_admins a where a.user_id = (select auth.uid())
  )
);

create policy "admin_delete_own_posts" on public.posts
for delete to authenticated using (
  author_id = (select auth.uid()) and exists (
    select 1 from public.blog_admins a where a.user_id = (select auth.uid())
  )
);

-- IMPORTANT: Run separately AFTER creating the owner account in Auth > Users:
-- insert into public.blog_admins(user_id) values ('PUT-YOUR-OWNER-USER-UUID-HERE');
-- Disable public sign-ups in Auth settings; this application has no signup UI.
