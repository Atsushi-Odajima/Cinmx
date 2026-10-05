-- CinemiX B 段階: テンプレート共有の最小スキーマ（Postgres / Supabase）
-- 原則: 所有者だけが編集。他者は public かつ approved だけ取得。管理者ロールはクライアントから書き換え不可。

create extension if not exists "pgcrypto";

-- ---- profiles: ロール（admin/user）。auth.users と 1:1。role は RLS で本人も更新不可。
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'admin')),
  display_name text check (char_length(display_name) <= 40),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

-- 本人は自分の profile を読める。display_name だけ更新可（role は trigger で固定）。
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.protect_profile_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role は変更できません';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role before update on public.profiles for each row execute procedure public.protect_profile_role();

-- ---- templates: 投稿（バージョン付き）。manifest は Template JSON（クライアントで Zod 検証、サーバーでも基本検査）。
create table if not exists public.templates (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  description text not null default '' check (char_length(description) <= 200),
  version integer not null default 1 check (version >= 1),
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  moderation_status text not null default 'pending' check (moderation_status in ('pending', 'approved', 'rejected')),
  moderation_note text,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists templates_public_idx on public.templates (visibility, moderation_status, updated_at desc);
create index if not exists templates_owner_idx on public.templates (owner_id, updated_at desc);
alter table public.templates enable row level security;

-- 過去バージョンの保全（利用側は使用時のスナップショットを保存するが、サーバー側にも履歴を残す）
create table if not exists public.template_versions (
  template_id uuid not null references public.templates (id) on delete cascade,
  version integer not null,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  primary key (template_id, version)
);
alter table public.template_versions enable row level security;

create or replace function public.templates_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
    new.moderation_status := 'pending';
  else
    -- owner / id は変更不可。承認状態は管理者 RPC からのみ変更（この trigger では一般利用者の変更を拒否）
    if new.owner_id <> old.owner_id or new.id <> old.id then
      raise exception '所有者は変更できません';
    end if;
    if not public.is_admin() then
      -- 内容更新（manifest/version 変更）は再審査。公開範囲の変更だけなら状態を保つ。
      if new.manifest is distinct from old.manifest or new.version <> old.version or new.name <> old.name or new.description <> old.description then
        new.moderation_status := 'pending';
        new.moderation_note := null;
      else
        new.moderation_status := old.moderation_status;
        new.moderation_note := old.moderation_note;
      end if;
    end if;
  end if;
  -- manifest の基本検査（詳細はクライアント Zod。ここでは構造の最低限）
  if jsonb_typeof(new.manifest -> 'slots') <> 'array' or jsonb_array_length(new.manifest -> 'slots') < 3 or jsonb_array_length(new.manifest -> 'slots') > 10 then
    raise exception 'manifest.slots が不正です';
  end if;
  if (new.manifest ->> 'aspectRatio') <> '9:16' then
    raise exception 'aspectRatio は 9:16 のみ対応';
  end if;
  if pg_column_size(new.manifest) > 65536 then
    raise exception 'manifest が大きすぎます';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists templates_before_write on public.templates;
create trigger templates_before_write before insert or update on public.templates for each row execute procedure public.templates_before_write();

create or replace function public.templates_after_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.template_versions (template_id, version, manifest) values (new.id, new.version, new.manifest)
  on conflict (template_id, version) do update set manifest = excluded.manifest;
  return new;
end $$;
drop trigger if exists templates_after_write on public.templates;
create trigger templates_after_write after insert or update on public.templates for each row execute procedure public.templates_after_write();

-- ブロック: 利用者が投稿者をブロック（その投稿者の公開テンプレートを自分の一覧から除く）
create table if not exists public.blocks (
  blocker_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  blocked_owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_owner_id)
);
alter table public.blocks enable row level security;
drop policy if exists "blocks_own" on public.blocks;
create policy "blocks_own" on public.blocks for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- RLS: templates
drop policy if exists "templates_select" on public.templates;
create policy "templates_select" on public.templates for select using (
  owner_id = auth.uid()
  or public.is_admin()
  or (
    visibility = 'public' and moderation_status = 'approved'
    and not exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_owner_id = templates.owner_id)
  )
);
drop policy if exists "templates_insert_own" on public.templates;
create policy "templates_insert_own" on public.templates for insert with check (auth.uid() is not null and owner_id = auth.uid());
drop policy if exists "templates_update_own" on public.templates;
create policy "templates_update_own" on public.templates for update using (owner_id = auth.uid() or public.is_admin()) with check (owner_id = auth.uid() or public.is_admin());
drop policy if exists "templates_delete_own" on public.templates;
create policy "templates_delete_own" on public.templates for delete using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "template_versions_select" on public.template_versions;
create policy "template_versions_select" on public.template_versions for select using (
  exists (select 1 from public.templates t where t.id = template_versions.template_id) -- templates の RLS を通る行のみ
);

-- ---- template_assets: Storage 上のファイル参照（private bucket）
create table if not exists public.template_assets (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  version integer not null,
  kind text not null check (kind in ('background', 'cover', 'preview', 'licenses')),
  storage_path text not null,
  byte_size integer not null check (byte_size >= 0 and byte_size <= 26214400),
  mime text not null,
  created_at timestamptz not null default now(),
  unique (template_id, version, kind)
);
alter table public.template_assets enable row level security;
drop policy if exists "template_assets_select" on public.template_assets;
create policy "template_assets_select" on public.template_assets for select using (
  exists (select 1 from public.templates t where t.id = template_assets.template_id)
);
drop policy if exists "template_assets_write_own" on public.template_assets;
create policy "template_assets_write_own" on public.template_assets for all using (
  exists (select 1 from public.templates t where t.id = template_assets.template_id and t.owner_id = auth.uid())
) with check (
  exists (select 1 from public.templates t where t.id = template_assets.template_id and t.owner_id = auth.uid())
  and storage_path like auth.uid()::text || '/' || template_id::text || '/%'
);

-- ---- reports: 通報。投稿者は自分の通報だけ読める。管理者は全件。
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  reporter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason text not null check (reason in ('copyright', 'inappropriate', 'spam', 'other')),
  detail text not null default '' check (char_length(detail) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "reports_insert" on public.reports;
create policy "reports_insert" on public.reports for insert with check (auth.uid() is not null and reporter_id = auth.uid());
drop policy if exists "reports_select" on public.reports;
create policy "reports_select" on public.reports for select using (reporter_id = auth.uid() or public.is_admin());
drop policy if exists "reports_update_admin" on public.reports;
create policy "reports_update_admin" on public.reports for update using (public.is_admin()) with check (public.is_admin());

-- ---- 管理者 RPC: 承認・却下（Edge Function からも呼ぶ。サーバー側で is_admin を確認）
create or replace function public.moderate_template(p_template_id uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception '権限がありません' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'decision が不正です';
  end if;
  update public.templates set moderation_status = p_decision, moderation_note = p_note, updated_at = now() where id = p_template_id;
end $$;
revoke all on function public.moderate_template(uuid, text, text) from public;
grant execute on function public.moderate_template(uuid, text, text) to authenticated;

-- ---- Storage: private bucket。直接の select は所有者と管理者のみ（公開配布は署名 URL を発行する Edge Function 経由）。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('template-assets', 'template-assets', false, 26214400, array['image/png', 'image/jpeg', 'video/mp4', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = array['image/png', 'image/jpeg', 'video/mp4', 'text/plain'];

drop policy if exists "template_assets_storage_owner_rw" on storage.objects;
create policy "template_assets_storage_owner_rw" on storage.objects for all
  using (bucket_id = 'template-assets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'template-assets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "template_assets_storage_admin_read" on storage.objects;
create policy "template_assets_storage_admin_read" on storage.objects for select using (bucket_id = 'template-assets' and public.is_admin());
