import { createClient, type SupabaseClient, type Session, type User } from '@supabase/supabase-js';
import type { CloudConfig } from './config';

export type CloudSession = { user: User; session: Session };

export class CloudClient {
  readonly supabase: SupabaseClient;
  constructor(readonly config: CloudConfig) {
    this.supabase = createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  async getSession(): Promise<CloudSession | null> {
    const { data } = await this.supabase.auth.getSession();
    if (!data.session) return null;
    return { user: data.session.user, session: data.session };
  }

  async signInWithPassword(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    return error ? { ok: false, message: error.message } : { ok: true };
  }

  async signUp(email: string, password: string): Promise<{ ok: true; needsConfirmation: boolean } | { ok: false; message: string }> {
    const { data, error } = await this.supabase.auth.signUp({ email, password });
    if (error) return { ok: false, message: error.message };
    return { ok: true, needsConfirmation: !data.session };
  }

  async signInWithMagicLink(email: string, redirectTo?: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const { error } = await this.supabase.auth.signInWithOtp({ email, options: redirectTo ? { emailRedirectTo: redirectTo } : {} });
    return error ? { ok: false, message: error.message } : { ok: true };
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }

  onAuthChange(cb: (s: CloudSession | null) => void): () => void {
    const { data } = this.supabase.auth.onAuthStateChange((_e, session) => {
      cb(session ? { user: session.user, session } : null);
    });
    return () => data.subscription.unsubscribe();
  }

  /** 管理者かどうかはサーバー側の profiles.role を読む（クライアントは書き換えられない: RLS） */
  async isAdmin(): Promise<boolean> {
    const s = await this.getSession();
    if (!s) return false;
    const { data } = await this.supabase.from('profiles').select('role').eq('id', s.user.id).maybeSingle();
    return data?.role === 'admin';
  }
}
