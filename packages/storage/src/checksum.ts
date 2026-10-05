/** SHA-256 (hex)。crypto.subtle が使えない環境では FNV-1a 64bit 相当の簡易ハッシュ（識別用途のみ）。 */
export async function checksumBlob(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const buf = await blob.arrayBuffer();
    const digest = await subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let h1 = 0xcbf29ce4;
  let h2 = 0x84222325;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b, 0x01000193) >>> 0;
  }
  return `fnv-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}${bytes.length.toString(16)}`;
}
