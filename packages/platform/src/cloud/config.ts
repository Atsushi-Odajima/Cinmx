export type CloudConfig = {
  url: string;
  /** publishable / anon key のみ。service_role は Web に埋め込まない。 */
  publishableKey: string;
};

export function readCloudConfig(env: Record<string, string | undefined>): CloudConfig | null {
  const url = env['VITE_SUPABASE_URL']?.trim();
  const key = env['VITE_SUPABASE_PUBLISHABLE_KEY']?.trim() || env['VITE_SUPABASE_ANON_KEY']?.trim();
  if (!url || !key) return null;
  if (!/^https:\/\//.test(url)) return null;
  if (/service_role/i.test(key)) return null; // 誤って service_role を入れた場合は使わない
  return { url, publishableKey: key };
}
