-- RLS テスト（pgTAP）。ローカル: `supabase start` → `supabase test db`
-- 検証: 別アカウントは非公開テンプレートを取得できない／一般利用者は承認できない／所有者だけ編集できる。
begin;
select plan(9);

-- テストユーザー
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'alice@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'bob@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'admin@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000003';

-- alice が非公開テンプレートを投稿
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.templates (id, owner_id, name, description, version, visibility, manifest)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Alice private', '', 1, 'private',
  '{"aspectRatio":"9:16","slots":[{},{},{},{},{}]}'::jsonb);
insert into public.templates (id, owner_id, name, description, version, visibility, manifest)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Alice public', '', 1, 'public',
  '{"aspectRatio":"9:16","slots":[{},{},{},{},{}]}'::jsonb);
select is((select count(*) from public.templates where owner_id = '00000000-0000-0000-0000-000000000001'), 2::bigint, 'alice sees her own 2 templates');

-- bob は alice の非公開も、未承認の公開申請も見えない
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.templates), 0::bigint, 'bob cannot see private or pending templates');
select throws_ok($$ select public.moderate_template('10000000-0000-0000-0000-000000000002', 'approved') $$, '42501', null, 'bob (user) cannot approve');
select is((select count(*) from (update public.templates set name = 'hacked' where id = '10000000-0000-0000-0000-000000000001' returning 1) x), 0::bigint, 'bob cannot update alice''s template');

-- bob が自分のロールを admin にしようとしても拒否
select throws_ok($$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000002' $$, null, null, 'bob cannot escalate role');

-- 管理者が承認
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok($$ select public.moderate_template('10000000-0000-0000-0000-000000000002', 'approved', 'ok') $$, 'admin can approve');

-- bob は承認済み公開だけ見える
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.templates), 1::bigint, 'bob sees exactly the approved public template');
select is((select name from public.templates limit 1), 'Alice public', 'and it is the public one');

-- 匿名（未ログイン）も承認済み公開だけ
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*) from public.templates), 1::bigint, 'anon sees only approved public templates');

select * from finish();
rollback;
