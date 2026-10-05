export function fmtSec(ms: number, digits = 1): string {
  return (Math.round(ms / 100) / 10).toFixed(digits);
}
export function fmtClock(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s)}.${Math.floor((s % 1) * 10)}`;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
