/**
 * Render the reminder sounds to WAV files.
 *
 * The web client synthesizes these with WebAudio at play time. Android cannot:
 * a notification channel's sound is a file URI chosen when the channel is
 * created, and the OS plays it while our JS is not running. So the same note
 * tables are rendered ahead of time and shipped as assets.
 *
 * Keeping one table for both clients is the point — "chime" should be the same
 * two rising notes whichever screen you heard it from. If you change a design
 * in `apps/web/src/lib/notify.ts`, re-run this:
 *
 *     node scripts/build-sounds.mjs
 *
 * The output is committed, because a build must not depend on this having been
 * run and `expo prebuild` needs the files to exist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/sounds",
);

const SAMPLE_RATE = 44100;

/**
 * The designs, copied from `apps/web/src/lib/notify.ts`.
 *
 * `level` is loudness within the sound, 0–1. `type` is the oscillator shape;
 * the default is a sine.
 */
const SOUNDS = {
  // Two rising notes. The default: clear without being startling.
  chime: [
    { freq: 880, at: 0, dur: 0.18 },
    { freq: 1318.5, at: 0.16, dur: 0.34 },
  ],
  // A struck bell: fundamental plus a slightly inharmonic partial, long tail.
  bell: [
    { freq: 660, at: 0, dur: 1.5 },
    { freq: 1650, at: 0, dur: 0.9, level: 0.35 },
    { freq: 990, at: 0.01, dur: 1.2, level: 0.2 },
  ],
  // Three soft wooden notes. Triangle waves and fast decay read as "mallet".
  marimba: [
    { freq: 523.25, at: 0, dur: 0.28, type: "triangle" },
    { freq: 659.25, at: 0.11, dur: 0.28, type: "triangle" },
    { freq: 783.99, at: 0.22, dur: 0.42, type: "triangle" },
  ],
  // Two low blips. Discreet enough for a shared room.
  pulse: [
    { freq: 220, at: 0, dur: 0.09, type: "square", level: 0.5 },
    { freq: 220, at: 0.15, dur: 0.09, type: "square", level: 0.5 },
  ],
  // Insistent. For the things you must not sleep through.
  alert: [
    { freq: 1046.5, at: 0, dur: 0.12, type: "square", level: 0.7 },
    { freq: 1318.5, at: 0.14, dur: 0.12, type: "square", level: 0.7 },
    { freq: 1046.5, at: 0.28, dur: 0.12, type: "square", level: 0.7 },
    { freq: 1318.5, at: 0.42, dur: 0.3, type: "square", level: 0.7 },
  ],
};

/** One cycle of the named shape at phase `p` (0–1). */
function wave(type, p) {
  switch (type) {
    case "square":
      // Softened rather than a hard ±1: a raw square through a phone speaker
      // is mostly aliasing, and it clips the sum when notes overlap.
      return p < 0.5 ? 0.7 : -0.7;
    case "triangle":
      return 4 * Math.abs(p - 0.5) - 1;
    default:
      return Math.sin(2 * Math.PI * p);
  }
}

function render(notes) {
  const end = Math.max(...notes.map((n) => n.at + n.dur)) + 0.05;
  const frames = Math.ceil(end * SAMPLE_RATE);
  const buffer = new Float32Array(frames);

  for (const note of notes) {
    const level = note.level ?? 1;
    const start = Math.floor(note.at * SAMPLE_RATE);
    const length = Math.floor(note.dur * SAMPLE_RATE);

    for (let i = 0; i < length; i++) {
      const t = i / SAMPLE_RATE;
      /*
       * Exponential decay, matching the WebAudio version's
       * exponentialRampToValueAtTime. A linear fade sounds like a synth pad;
       * this sounds like something being struck.
       */
      const envelope = Math.exp(-4 * (t / note.dur));
      /* 4ms fade-in — without it every note starts on a click. */
      const attack = Math.min(1, t / 0.004);
      const phase = (note.freq * t) % 1;
      buffer[start + i] += wave(note.type, phase) * envelope * attack * level;
    }
  }

  /*
   * Normalise to -3 dBFS. Notification volume is the OS's business, not ours,
   * but a file that clips sounds broken at every volume.
   */
  let peak = 0;
  for (const s of buffer) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 0.707 / peak : 1;

  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    const clamped = Math.max(-1, Math.min(1, buffer[i] * gain));
    pcm.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return pcm;
}

/** 16-bit mono PCM in a RIFF container — the format Android is happiest with. */
function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const [id, notes] of Object.entries(SOUNDS)) {
  const file = path.join(OUT_DIR, `${id}.wav`);
  const data = wav(render(notes));
  fs.writeFileSync(file, data);
  console.log(`${id}.wav  ${(data.length / 1024).toFixed(1)} KB`);
}
