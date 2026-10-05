import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OUT_DIR = join(process.cwd(), 'e2e-output');

export function saveBase64(name: string, base64: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = join(OUT_DIR, name);
  writeFileSync(p, Buffer.from(base64, 'base64'));
  return p;
}

export function hasTool(bin: string): boolean {
  try {
    execFileSync(bin, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export type Probe = { streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; nb_frames?: string; duration?: string; sample_rate?: string; channels?: number }[]; format: { duration: string; format_name: string; size: string } };

export function ffprobe(path: string): Probe {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { encoding: 'utf8' });
  return JSON.parse(out) as Probe;
}

export function extractFrame(path: string, atSec: number, outName: string): string {
  const out = join(OUT_DIR, outName);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(atSec), '-i', path, '-frames:v', '1', out]);
  return out;
}

/** ImageMagick で画像の標準偏差（0..1）を得る。0 に近ければ無地。 */
export function imageStdDev(path: string): number {
  const out = execFileSync('convert', [path, '-colorspace', 'Gray', '-format', '%[fx:standard_deviation]', 'info:'], { encoding: 'utf8' });
  return Number(out.trim());
}

/** 2 画像の RMSE（0..1） */
export function imageRmse(a: string, b: string): number {
  try {
    execFileSync('compare', ['-metric', 'RMSE', a, b, 'null:'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    const err = e as { stderr?: string | Buffer };
    const m = String(err.stderr ?? '').match(/\(([0-9.eE+-]+)\)/);
    return m ? Number(m[1]) : NaN;
  }
}

/** 音声を WAV に取り出し、区間ごとの RMS を Python(audioop) で計算する */
export function audioRms(path: string, windows: [number, number][]): number[] {
  const wav = join(OUT_DIR, 'audio.wav');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '48000', '-f', 'wav', wav]);
  const py = `
import wave, audioop, sys, json
w = wave.open(sys.argv[1], 'rb'); sr = w.getframerate(); n = w.getnframes(); data = w.readframes(n); sw = w.getsampwidth()
out = []
for a, b in json.loads(sys.argv[2]):
    s = data[int(a*sr)*sw:int(b*sr)*sw]
    out.append(audioop.rms(s, sw) / 32768.0 if len(s) >= sw else 0.0)
print(json.dumps(out))
`;
  const res = execFileSync('python3', ['-c', py, wav, JSON.stringify(windows)], { encoding: 'utf8' });
  return JSON.parse(res) as number[];
}
