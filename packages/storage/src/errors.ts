export type StorageErrorCode = 'quota-exceeded' | 'not-found' | 'corrupt' | 'invalid' | 'io' | 'unsupported';

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name ?? '';
  const inner = (e as { inner?: { name?: string } }).inner?.name ?? '';
  return name === 'QuotaExceededError' || inner === 'QuotaExceededError' || /quota/i.test(String((e as { message?: string }).message ?? ''));
}

export function toStorageError(e: unknown, fallback: string): StorageError {
  if (e instanceof StorageError) return e;
  if (isQuotaError(e)) return new StorageError('quota-exceeded', '端末の保存容量が足りません。既存の下書きは保持されています。不要な下書きや素材を削除してから、もう一度保存してください。', e);
  return new StorageError('io', fallback, e);
}
