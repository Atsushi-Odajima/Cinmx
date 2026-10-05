import type { AdPlacement, AdService, AdShowResult, PurchaseService } from './adapters';

export class NoOpAdService implements AdService {
  readonly mode = 'noop' as const;
  async prepare(): Promise<void> {}
  async show(): Promise<AdShowResult> {
    return 'disabled';
  }
  close(): void {}
  onFailure(): void {}
}

/** 開発設定でだけ有効。「テスト広告」と明示し、実広告 SDK は接続しない。 */
export class DevSimulatedAdService implements AdService {
  readonly mode = 'dev-simulated' as const;
  private failureCb: ((placement: AdPlacement, reason: string) => void) | null = null;
  private listeners = new Set<(placement: AdPlacement | null) => void>();
  private current: AdPlacement | null = null;

  constructor(private readonly simulateFailure = false) {}

  subscribe(cb: (placement: AdPlacement | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  async prepare(): Promise<void> {}
  async show(placement: AdPlacement): Promise<AdShowResult> {
    if (this.simulateFailure) {
      this.failureCb?.(placement, 'simulated-failure');
      return 'failed';
    }
    this.current = placement;
    for (const l of this.listeners) l(placement);
    return 'shown';
  }
  close(placement: AdPlacement): void {
    if (this.current === placement) {
      this.current = null;
      for (const l of this.listeners) l(null);
    }
  }
  onFailure(cb: (placement: AdPlacement, reason: string) => void): void {
    this.failureCb = cb;
  }
}

export class NoOpPurchaseService implements PurchaseService {
  readonly mode = 'noop' as const;
  async hasAdFree(): Promise<boolean> {
    return false;
  }
  async purchaseAdFree(): Promise<{ status: 'not-available'; message: string }> {
    return { status: 'not-available', message: '広告解除（月額500円）は iPhone アプリ版で予定しています。この Web 試作では購入できません。' };
  }
}
