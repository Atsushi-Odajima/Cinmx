import { LIMITS } from '../schema/limits';

/**
 * 元に戻す／やり直し（最大 30 操作）。利用者の操作単位でスナップショットを積む。
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private readonly max = LIMITS.history.maxEntries) {}

  push(previous: T): void {
    this.past.push(previous);
    if (this.past.length > this.max) this.past.shift();
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(current: T): T | undefined {
    const prev = this.past.pop();
    if (prev === undefined) return undefined;
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }

  get size(): number {
    return this.past.length;
  }
}
