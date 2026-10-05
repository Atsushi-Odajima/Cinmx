// 署名 URL の発行。認可（所有者 / 管理者 / public かつ approved）を確認してから短寿命（120 秒）の URL を返す。
// URL を知っているだけでは非公開データにアクセスできない。署名 URL は失効まで短時間の残存アクセスがある。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SIGNED_URL_TTL_SEC = 120;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { templateId, kind } = await req.json();
    if (typeof templateId !== 'string' || !['background', 'cover', 'preview', 'licenses'].includes(kind)) {
      return json({ error: 'bad request' }, 400);
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // Edge Function 内だけで使用。Web へ埋め込まない。
    const authHeader = req.headers.get('Authorization') ?? '';
    // 呼び出し元の権限で templates を読む（RLS が認可を決める）
    const asUser = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: tpl, error } = await asUser.from('templates').select('id, version').eq('id', templateId).maybeSingle();
    if (error || !tpl) return json({ error: 'not found' }, 404);
    const { data: asset } = await asUser.from('template_assets').select('storage_path').eq('template_id', templateId).eq('version', tpl.version).eq('kind', kind).maybeSingle();
    if (!asset) return json({ error: 'asset not found' }, 404);
    // 認可済みなので service role で署名
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: signed, error: sErr } = await admin.storage.from('template-assets').createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SEC);
    if (sErr || !signed) return json({ error: 'sign failed' }, 500);
    return json({ url: signed.signedUrl, expiresInSec: SIGNED_URL_TTL_SEC });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
