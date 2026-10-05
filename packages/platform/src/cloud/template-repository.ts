import type { Template } from '@cinemix/core';
import { templateSchema, totalDurationMs } from '@cinemix/core';
import type { CloudClient } from './client';
import type { ModerationStatus, PublishInput, PublishResult, TemplateListItem, TemplateVisibility } from '../adapters';

export type RemoteTemplateRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  version: number;
  visibility: TemplisibilityCompat;
  moderation_status: ModerationStatus;
  manifest: unknown;
  created_at: string;
  updated_at: string;
};
type TemplisibilityCompat = TemplateVisibility;

export type RemoteAssetRow = { id: string; template_id: string; version: number; kind: 'background' | 'cover' | 'preview' | 'licenses'; storage_path: string; byte_size: number; mime: string };

export type ReportInput = { templateId: string; reason: 'copyright' | 'inappropriate' | 'spam' | 'other'; detail: string };

/**
 * オンラインのテンプレート共有（B）。閲覧はログイン不要（public & approved のみ RLS で取得可能）。
 * 投稿・非公開切替・通報はログインが必要。
 */
export class CloudTemplateRepository {
  constructor(private readonly client: CloudClient) {}

  async listPublic(limit = 50): Promise<TemplateListItem[]> {
    const { data, error } = await this.client.supabase
      .from('templates')
      .select('id, owner_id, name, description, version, visibility, moderation_status, manifest, created_at, updated_at')
      .eq('visibility', 'public')
      .eq('moderation_status', 'approved')
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`オンラインのテンプレートを取得できません: ${error.message}`);
    return (data as RemoteTemplateRow[]).flatMap((r) => this.toItem(r));
  }

  async listMine(): Promise<TemplateListItem[]> {
    const s = await this.client.getSession();
    if (!s) return [];
    const { data, error } = await this.client.supabase
      .from('templates')
      .select('id, owner_id, name, description, version, visibility, moderation_status, manifest, created_at, updated_at')
      .eq('owner_id', s.user.id)
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as RemoteTemplateRow[]).flatMap((r) => this.toItem(r));
  }

  async get(remoteId: string): Promise<{ template: Template; row: RemoteTemplateRow } | undefined> {
    const { data, error } = await this.client.supabase.from('templates').select('*').eq('id', remoteId).maybeSingle();
    if (error || !data) return undefined;
    const row = data as RemoteTemplateRow;
    const parsed = templateSchema.safeParse(row.manifest);
    if (!parsed.success) return undefined;
    return { template: parsed.data, row };
  }

  /** 署名 URL は認可を確認するサーバー関数経由で発行する（URL を知っているだけではアクセスできない） */
  async getAssetUrl(remoteId: string, kind: RemoteAssetRow['kind']): Promise<string | null> {
    const { data, error } = await this.client.supabase.functions.invoke<{ url: string }>('template-asset-url', { body: { templateId: remoteId, kind } });
    if (error || !data?.url) return null;
    return data.url;
  }

  async publish(input: PublishInput): Promise<PublishResult | { status: 'auth-required' }> {
    const s = await this.client.getSession();
    if (!s) return { status: 'auth-required' };
    const parsed = templateSchema.safeParse({ ...input.template, backgroundAssetId: undefined });
    if (!parsed.success) throw new Error('テンプレートが不正です');
    const manifest = { ...parsed.data };
    delete manifest.backgroundAssetId;
    // 1. 行をバージョン付きで upsert（同 id なら version+1）。RLS: owner のみ。
    const existing = await this.client.supabase.from('templates').select('version').eq('id', manifest.id).maybeSingle();
    const version = (existing.data?.version ?? 0) + 1;
    const { error: upErr } = await this.client.supabase.from('templates').upsert({
      id: manifest.id,
      owner_id: s.user.id,
      name: manifest.name,
      description: manifest.description,
      version,
      visibility: input.visibility,
      moderation_status: 'pending',
      manifest,
    });
    if (upErr) throw new Error(`投稿に失敗しました: ${upErr.message}`);
    // 2. ファイルを private bucket へ（パスは owner/template/version/kind）
    const uploads: { kind: RemoteAssetRow['kind']; blob: Blob; name: string; mime: string }[] = [
      { kind: 'cover', blob: input.coverPng, name: 'cover.png', mime: 'image/png' },
      { kind: 'licenses', blob: new Blob([input.licensesText], { type: 'text/plain' }), name: 'licenses.txt', mime: 'text/plain' },
    ];
    if (input.backgroundJpeg) uploads.push({ kind: 'background', blob: input.backgroundJpeg, name: 'background.jpg', mime: 'image/jpeg' });
    if (input.previewMp4) uploads.push({ kind: 'preview', blob: input.previewMp4, name: 'preview.mp4', mime: 'video/mp4' });
    for (const u of uploads) {
      const path = `${s.user.id}/${manifest.id}/${version}/${u.name}`;
      const { error } = await this.client.supabase.storage.from('template-assets').upload(path, u.blob, { contentType: u.mime, upsert: true });
      if (error) throw new Error(`ファイルの送信に失敗しました (${u.name}): ${error.message}`);
      const { error: aErr } = await this.client.supabase.from('template_assets').upsert({ template_id: manifest.id, version, kind: u.kind, storage_path: path, byte_size: u.blob.size, mime: u.mime }, { onConflict: 'template_id,version,kind' });
      if (aErr) throw new Error(aErr.message);
    }
    return { remoteId: manifest.id, version, visibility: input.visibility, moderationStatus: 'pending' };
  }

  async setVisibility(remoteId: string, visibility: TemplateVisibility): Promise<void> {
    const { error } = await this.client.supabase.from('templates').update({ visibility }).eq('id', remoteId);
    if (error) throw new Error(error.message);
  }

  async delete(remoteId: string): Promise<void> {
    const { error } = await this.client.supabase.from('templates').delete().eq('id', remoteId);
    if (error) throw new Error(error.message);
  }

  async report(input: ReportInput): Promise<void> {
    const { error } = await this.client.supabase.from('reports').insert({ template_id: input.templateId, reason: input.reason, detail: input.detail.slice(0, 1000) });
    if (error) throw new Error(error.message);
  }

  async blockAuthor(ownerId: string): Promise<void> {
    const { error } = await this.client.supabase.from('blocks').insert({ blocked_owner_id: ownerId });
    if (error) throw new Error(error.message);
  }

  /* ---- 管理者（サーバーで権限確認） ---- */
  async listPending(): Promise<RemoteTemplateRow[]> {
    const { data, error } = await this.client.supabase.from('templates').select('*').eq('moderation_status', 'pending').order('updated_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data as RemoteTemplateRow[];
  }

  async moderate(remoteId: string, decision: 'approved' | 'rejected', note: string): Promise<void> {
    const { error } = await this.client.supabase.functions.invoke('moderate-template', { body: { templateId: remoteId, decision, note } });
    if (error) throw new Error(`審査の送信に失敗しました: ${error.message}`);
  }

  async listReports(): Promise<{ id: string; template_id: string; reason: string; detail: string; created_at: string; status: string }[]> {
    const { data, error } = await this.client.supabase.from('reports').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data as { id: string; template_id: string; reason: string; detail: string; created_at: string; status: string }[];
  }

  private toItem(r: RemoteTemplateRow): TemplateListItem[] {
    const parsed = templateSchema.safeParse(r.manifest);
    if (!parsed.success) return [];
    const t = parsed.data;
    return [
      {
        id: r.id,
        name: t.name,
        description: t.description,
        requiredAssetCount: t.requiredAssetCount,
        durationMs: totalDurationMs(t),
        ...(t.styleLabel ? { styleLabel: t.styleLabel } : {}),
        aspectRatio: '9:16',
        source: 'online',
        cloud: { visibility: r.visibility, moderationStatus: r.moderation_status, version: r.version },
      },
    ];
  }
}
