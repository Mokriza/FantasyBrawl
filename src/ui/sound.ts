/**
 * Sounds. Blows and spells are recordings from Ninja Adventure (CC0), listed in
 * assets/vfx.json and loaded once, when the first sound plays; everything else (steps,
 * turns, win and loss, thunder) is made on the spot with the Web Audio API from a few
 * tones and bursts of noise. Which event makes which sound is decided in playback.ts
 * (soundOf); this only makes the noise. A recording that is not loaded yet is skipped.
 *
 * The switch is remembered in localStorage. The browser allows sound only after the
 * page has been clicked, so the context is created on the first sound and resumed
 * on the next click if it had to wait.
 */

import type { SoundName } from './playback.js';
import { SOUNDS as RECORDINGS } from './vfx.js';
import { assetUrl } from './assets/url.js';

const SOUND_KEY = 'arena.sound';
const MASTER_GAIN = 0.5;

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let enabled = readEnabled();
const listeners = new Set<() => void>();

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    window.localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Not remembered; the switch still holds for this visit.
  }
  for (const listener of listeners) listener();
}

export function onSoundChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (context === null) {
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return null;
    context = new window.AudioContext();
    master = context.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(context.destination);
    loadRecordings(context);
    // The context starts suspended until the page is clicked; the next click wakes it.
    window.addEventListener('pointerdown', () => void context?.resume(), { once: true });
  }
  if (master === null) return null;
  return { ctx: context, out: master };
}

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer === null) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // Interface code: real randomness is allowed here, and it changes nothing in the game.
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** A gain that rises fast and dies away: the shape of a plucked or struck sound. */
function envelope(ctx: AudioContext, out: AudioNode, at: number, length: number, peak: number): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.012, length / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  gain.connect(out);
  return gain;
}

interface Tone {
  readonly freq: number;
  readonly to?: number;
  readonly length: number;
  readonly gain: number;
  readonly wave?: OscillatorType;
  readonly delay?: number;
}

function tone(ctx: AudioContext, out: AudioNode, t: Tone): void {
  const at = ctx.currentTime + (t.delay ?? 0);
  const osc = ctx.createOscillator();
  osc.type = t.wave ?? 'sine';
  osc.frequency.setValueAtTime(t.freq, at);
  if (t.to !== undefined) osc.frequency.exponentialRampToValueAtTime(t.to, at + t.length);
  osc.connect(envelope(ctx, out, at, t.length, t.gain));
  osc.start(at);
  osc.stop(at + t.length + 0.02);
}

interface Noise {
  readonly length: number;
  readonly gain: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  readonly to?: number;
  readonly delay?: number;
}

function hiss(ctx: AudioContext, out: AudioNode, n: Noise): void {
  const at = ctx.currentTime + (n.delay ?? 0);
  const source = ctx.createBufferSource();
  source.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = n.filter;
  filter.frequency.setValueAtTime(n.freq, at);
  if (n.to !== undefined) filter.frequency.exponentialRampToValueAtTime(n.to, at + n.length);
  source.connect(filter);
  filter.connect(envelope(ctx, out, at, n.length, n.gain));
  source.start(at);
  source.stop(at + n.length + 0.02);
}

/** Decoded recordings by name; filled in the background once the context exists. */
const recorded = new Map<string, AudioBuffer>();

function loadRecordings(ctx: AudioContext): void {
  // Several sounds share a file: each file is fetched and decoded once.
  const namesByUrl = new Map<string, string[]>();
  for (const [name, info] of Object.entries(RECORDINGS)) {
    namesByUrl.set(info.url, [...(namesByUrl.get(info.url) ?? []), name]);
  }
  for (const [url, names] of namesByUrl) {
    void fetch(assetUrl(url))
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(response.statusText))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        for (const name of names) recorded.set(name, buffer);
      })
      .catch(() => {
        // A missing recording is just silence; the game never waits for a sound.
      });
  }
}

function playRecording(ctx: AudioContext, out: AudioNode, name: string): boolean {
  const buffer = recorded.get(name);
  const info = RECORDINGS[name];
  if (buffer === undefined || info === undefined) return false;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = info.volume;
  source.connect(gain);
  gain.connect(out);
  source.start();
  return true;
}

const SYNTHESISED: Record<string, (ctx: AudioContext, out: AudioNode) => void> = {
  step: (c, o) => hiss(c, o, { length: 0.05, gain: 0.05, filter: 'bandpass', freq: 380 }),
  swing: (c, o) => hiss(c, o, { length: 0.18, gain: 0.16, filter: 'bandpass', freq: 600, to: 2600 }),
  shoot: (c, o) => {
    hiss(c, o, { length: 0.13, gain: 0.1, filter: 'highpass', freq: 2000, to: 5000 });
    tone(c, o, { freq: 900, to: 480, length: 0.09, gain: 0.05, wave: 'triangle' });
  },
  spell: (c, o) => {
    tone(c, o, { freq: 320, to: 960, length: 0.26, gain: 0.08 });
    tone(c, o, { freq: 480, to: 1440, length: 0.26, gain: 0.04, wave: 'triangle' });
  },
  hit: (c, o) => {
    tone(c, o, { freq: 170, to: 55, length: 0.16, gain: 0.35 });
    hiss(c, o, { length: 0.08, gain: 0.18, filter: 'lowpass', freq: 1400 });
  },
  hitMagic: (c, o) => {
    tone(c, o, { freq: 760, to: 190, length: 0.16, gain: 0.05, wave: 'square' });
    tone(c, o, { freq: 150, to: 60, length: 0.14, gain: 0.22 });
  },
  crit: (c, o) => {
    tone(c, o, { freq: 190, to: 50, length: 0.2, gain: 0.4 });
    hiss(c, o, { length: 0.1, gain: 0.22, filter: 'lowpass', freq: 2000 });
    tone(c, o, { freq: 1250, to: 1600, length: 0.14, gain: 0.07, wave: 'triangle', delay: 0.03 });
  },
  heal: (c, o) => {
    tone(c, o, { freq: 660, length: 0.14, gain: 0.07 });
    tone(c, o, { freq: 880, length: 0.24, gain: 0.07, delay: 0.1 });
  },
  block: (c, o) => {
    tone(c, o, { freq: 1400, to: 1300, length: 0.22, gain: 0.07, wave: 'triangle' });
    tone(c, o, { freq: 2100, length: 0.12, gain: 0.03, wave: 'triangle' });
  },
  status: (c, o) => tone(c, o, { freq: 520, to: 340, length: 0.16, gain: 0.05 }),
  death: (c, o) => {
    tone(c, o, { freq: 420, to: 70, length: 0.55, gain: 0.07, wave: 'sawtooth' });
    hiss(c, o, { length: 0.4, gain: 0.06, filter: 'lowpass', freq: 800, to: 150 });
  },
  turn: (c, o) => {
    tone(c, o, { freq: 880, length: 0.1, gain: 0.05 });
    tone(c, o, { freq: 1320, length: 0.2, gain: 0.05, delay: 0.09 });
  },
  win: (c, o) => [523, 659, 784, 1047].forEach((freq, i) => tone(c, o, { freq, length: 0.25, gain: 0.07, delay: i * 0.11 })),
  lose: (c, o) => [392, 330, 262].forEach((freq, i) => tone(c, o, { freq, length: 0.32, gain: 0.07, wave: 'triangle', delay: i * 0.16 })),
  // A crack, then the rumble rolling away: lightning.
  thunder: (c, o) => {
    hiss(c, o, { length: 0.09, gain: 0.35, filter: 'highpass', freq: 1800 });
    hiss(c, o, { length: 0.07, gain: 0.25, filter: 'bandpass', freq: 3200, delay: 0.05 });
    hiss(c, o, { length: 0.75, gain: 0.3, filter: 'lowpass', freq: 420, to: 90, delay: 0.04 });
    tone(c, o, { freq: 70, to: 38, length: 0.6, gain: 0.25, delay: 0.05 });
  },
};

/** Every sound name made by synthesis, for the data tests. */
export const SYNTHESISED_SOUNDS: readonly string[] = Object.keys(SYNTHESISED);

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const a = audio();
  if (a === null || a.ctx.state === 'closed') return;
  if (playRecording(a.ctx, a.out, name)) return;
  SYNTHESISED[name]?.(a.ctx, a.out);
}
