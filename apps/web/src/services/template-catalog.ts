import { BUILTIN_TEMPLATES, BUILTIN_TEMPLATE_IDS, totalDurationMs, type Template } from '@cinemix/core';
import type { TemplateListItem } from '@cinemix/platform';
import { localTemplateStore, cloudTemplates } from './index';

const BUILTIN_SLUGS: Record<string, string> = {
  [BUILTIN_TEMPLATE_IDS.quietCut]: 'quiet-cut',
  [BUILTIN_TEMPLATE_IDS.postcard]: 'postcard',
  [BUILTIN_TEMPLATE_IDS.contactStrip]: 'contact-strip',
};

export function builtinMedia(id: string): { coverUrl: string; previewUrl: string } | null {
  const slug = BUILTIN_SLUGS[id];
  return slug ? { coverUrl: `/templates/${slug}/cover.png`, previewUrl: `/templates/${slug}/preview.mp4` } : null;
}

export function toListItem(t: Template, source: TemplateListItem['source'], media?: { coverUrl?: string; previewUrl?: string }): TemplateListItem {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    requiredAssetCount: t.requiredAssetCount,
    durationMs: totalDurationMs(t),
    ...(t.styleLabel ? { styleLabel: t.styleLabel } : {}),
    aspectRatio: '9:16',
    source,
    ...(media?.coverUrl ? { coverUrl: media.coverUrl } : {}),
    ...(media?.previewUrl ? { previewUrl: media.previewUrl } : {}),
  };
}

const objectUrls = new Map<string, string>();
function objectUrlFor(key: string, blob: Blob | undefined): string | undefined {
  if (!blob) return undefined;
  const existing = objectUrls.get(key);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  return url;
}

export type CatalogResult = { items: TemplateListItem[]; onlineError: string | null; onlineConfigured: boolean };

/** 同梱 → 端末内 → オンライン（接続済みのみ）の順。オンライン失敗時も同梱は必ず出す。 */
export async function loadCatalog(): Promise<CatalogResult> {
  const items: TemplateListItem[] = BUILTIN_TEMPLATES.map((t) => toListItem(t, 'builtin', builtinMedia(t.id) ?? {}));
  try {
    const rows = await localTemplateStore.list();
    for (const r of rows) {
      const cover = objectUrlFor(`cover:${r.id}:${r.updatedAt}`, r.coverBlob);
      const preview = objectUrlFor(`preview:${r.id}:${r.updatedAt}`, r.previewBlob);
      const item = toListItem(r.template, r.origin === 'imported' ? 'imported' : 'local', { ...(cover ? { coverUrl: cover } : {}), ...(preview ? { previewUrl: preview } : {}) });
      if (r.cloud) item.cloud = { visibility: r.cloud.visibility, moderationStatus: r.cloud.moderationStatus, version: r.cloud.version };
      items.push(item);
    }
  } catch (e) {
    console.warn('[cinemix] local templates unavailable', e);
  }
  let onlineError: string | null = null;
  if (cloudTemplates) {
    try {
      const online = await cloudTemplates.listPublic();
      for (const o of online) if (!items.some((i) => i.id === o.id)) items.push(o);
    } catch (e) {
      onlineError = (e as Error).message;
    }
  }
  return { items, onlineError, onlineConfigured: !!cloudTemplates };
}

export async function resolveTemplate(id: string): Promise<{ template: Template; source: TemplateListItem['source'] } | undefined> {
  const b = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (b) return { template: b, source: 'builtin' };
  const local = await localTemplateStore.get(id);
  if (local) return { template: local.template, source: local.origin === 'imported' ? 'imported' : 'local' };
  if (cloudTemplates) {
    const remote = await cloudTemplates.get(id).catch(() => undefined);
    if (remote) return { template: remote.template, source: 'online' };
  }
  return undefined;
}
