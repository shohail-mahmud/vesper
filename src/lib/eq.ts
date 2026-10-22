/**
 * 10-band graphic equalizer definitions + presets (shared across Rust DSP and WebAudio).
 */

import type { EqSettings } from "../types";

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const EQ_LABELS = ["32", "64", "125", "250", "500", "1K", "2K", "4K", "8K", "16K"] as const;

export interface EqPreset {
  id: string;
  label: string;
  preamp: number;
  bands: [number, number, number, number, number, number, number, number, number, number];
}

export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", label: "Flat", preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "bass_boost", label: "Bass Boost", preamp: -1.5, bands: [6.5, 5.5, 4.0, 1.5, 0, 0, 0, 0.5, 1.0, 1.0] },
  { id: "treble_boost", label: "Crisp Treble", preamp: -1.0, bands: [0, 0, 0, 0, 0.5, 1.5, 3.0, 4.5, 5.5, 6.0] },
  { id: "vocal", label: "Vocal Presence", preamp: -1.0, bands: [-2.0, -1.5, -0.5, 1.5, 3.5, 4.5, 3.5, 1.5, 0, -1.0] },
  { id: "acoustic", label: "Acoustic", preamp: -1.0, bands: [3.5, 3.0, 2.0, 0.5, 1.0, 1.5, 2.5, 3.0, 2.5, 2.0] },
  { id: "electronic", label: "Electronic", preamp: -2.0, bands: [5.5, 4.5, 1.5, -1.0, -1.5, 0.5, 2.0, 3.5, 4.5, 5.0] },
  { id: "rock", label: "Rock", preamp: -1.5, bands: [4.5, 3.5, 1.5, -1.0, -1.5, 1.0, 3.0, 4.0, 4.5, 4.5] },
  { id: "classical", label: "Classical", preamp: -1.0, bands: [3.0, 2.5, 1.5, 0, -0.5, -0.5, 0.5, 2.0, 3.0, 3.5] },
  { id: "late_night", label: "Late Night", preamp: 0, bands: [-3.5, -2.0, 0, 1.5, 2.5, 2.5, 1.5, 0, -1.5, -2.5] },
];

export const DEFAULT_EQ: EqSettings = {
  enabled: false,
  preset: "flat",
  preamp: 0,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export function clampDb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-12, Math.min(12, Math.round(value * 2) / 2));
}

export function normalizeEq(eq?: Partial<EqSettings> | null): EqSettings {
  const bands = Array.from({ length: 10 }, (_, i) => clampDb(eq?.bands?.[i] ?? 0));
  return {
    enabled: Boolean(eq?.enabled),
    preset: eq?.preset || "flat",
    preamp: clampDb(eq?.preamp ?? 0),
    bands,
  };
}

export function presetToEq(presetId: string, enabled = true): EqSettings {
  const found = EQ_PRESETS.find((p) => p.id === presetId) ?? EQ_PRESETS[0];
  return {
    enabled,
    preset: found.id,
    preamp: found.preamp,
    bands: [...found.bands],
  };
}
