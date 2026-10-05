import type { ShareAdapter, ShareOutcome } from '../adapters';

export class WebShareAdapter implements ShareAdapter {
  canShare(file: File): boolean {
    const nav = globalThis.navigator as Navigator | undefined;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    try {
      return nav.canShare({ files: [file] });
    } catch {
      return false;
    }
  }

  async shareFile(file: File, title?: string): Promise<ShareOutcome> {
    if (!this.canShare(file)) return 'unsupported';
    try {
      await navigator.share({ files: [file], ...(title ? { title } : {}) });
      return 'shared';
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === 'AbortError') return 'cancelled';
      return 'failed';
    }
  }

  download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
