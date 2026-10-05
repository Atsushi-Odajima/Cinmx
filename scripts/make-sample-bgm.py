# 自作の試聴用 BGM（約 20 秒）。外部音源は使わない。標準ライブラリのみで WAV を生成し、ffmpeg があれば m4a (AAC) に変換する。
import math, struct, wave, subprocess, shutil, os, sys
SR = 48000
DUR = 20.0
N = int(SR * DUR)
BPM = 84
beat = 60.0 / BPM
# C major 7 系のやさしい進行（ルート周波数）
chords = [
    [261.63, 329.63, 392.00, 493.88],  # Cmaj7
    [220.00, 261.63, 329.63, 392.00],  # Am7
    [174.61, 220.00, 261.63, 329.63],  # Fmaj7
    [196.00, 246.94, 293.66, 349.23],  # G6
]
def env(t, a=0.02, d=0.25, s=0.55, r=0.3, dur=beat):
    if t < 0: return 0.0
    if t < a: return t / a
    if t < a + d: return 1.0 - (1.0 - s) * (t - a) / d
    if t < dur: return s
    return max(0.0, s * (1.0 - (t - dur) / r))
def tone(f, t, h=(1.0, 0.35, 0.12)):
    v = 0.0
    for i, g in enumerate(h):
        v += g * math.sin(2 * math.pi * f * (i + 1) * t)
    return v
frames = bytearray()
bar = beat * 4
for n in range(N):
    t = n / SR
    ci = int(t // bar) % len(chords)
    ch = chords[ci]
    tb = t % bar
    # パッド（コード）
    pad = sum(tone(f, t, (1.0, 0.2)) for f in ch) * 0.06 * (0.6 + 0.4 * math.sin(2 * math.pi * 0.25 * t))
    # アルペジオ（8 分音符）
    step = beat / 2
    k = int(tb // step)
    nf = ch[k % len(ch)] * (2 if k >= 4 else 1)
    arp = tone(nf, t) * 0.11 * env(tb - k * step, dur=step * 0.9)
    # ベース（1 拍目と 3 拍目）
    bk = int(tb // (beat * 2))
    bass = tone(ch[0] / 2, t, (1.0, 0.15)) * 0.13 * env(tb - bk * beat * 2, a=0.01, d=0.4, s=0.4, r=0.5, dur=beat * 1.6)
    v = pad + arp + bass
    # 全体フェードイン／アウト
    g = min(1.0, t / 1.5) * min(1.0, (DUR - t) / 2.0)
    s = max(-1.0, min(1.0, v * g * 0.9))
    frames += struct.pack('<hh', int(s * 32767 * 0.95), int(s * 32767 * 0.95))
out_wav = sys.argv[1]
with wave.open(out_wav, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(bytes(frames))
print('wrote', out_wav)
if shutil.which('ffmpeg'):
    m4a = os.path.splitext(out_wav)[0] + '.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', out_wav, '-c:a', 'libmp3lame', '-b:a', '128k', m4a], check=True)
    os.remove(out_wav)
    print('wrote', m4a)
