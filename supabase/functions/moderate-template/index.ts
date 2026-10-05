// 管理者だけが承認・却下できる。権限は DB 関数 moderate_template 内の is_admin() で確認（クライアントのロール申告は信用しない）。
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { templateId, decision, note } = await req.json();
    if (typeof templateId !== 'string' || !['approved', 'rejected'].includes(decision)) return json({ error: 'bad request' }, 400);
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { error } = await asUser.rpc('moderate_template', { p_template_id: templateId, p_decision: decision, p_note: typeof note === 'string' ? note.slice(0, 500) : null });
    if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
