// lib/color-math.ts — Foundation module for all color operations
// Uses OKLCH color space via culori for perceptually uniform color math

import { parse, oklch, formatHex, differenceEuclidean } from "culori";
import type { Oklch } from "culori";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OklchColor {
  l: number;
  c: number;
  h: number;
}

export interface OklchOffset {
  dL: number;
  dC: number;
  dH: number;
}

export interface NormalizedPalette {
  minL: number;
  maxL: number;
  minC: number;
  maxC: number;
}

export interface NormalizedPosition {
  normalized_L: number;
  normalized_C: number;
}

// 6D feature vector: [L, C, H, normalized_L, normalized_C, is_warm]
export type FeatureVector = [number, number, number, number, number, number];

// ─── Conversions ─────────────────────────────────────────────────────────────

/**
 * Convert a hex color string to OKLCH.
 * Handles 3-digit, 6-digit, and 8-digit hex with or without '#'.
 */
export function hexToOklch(hex: string): OklchColor {
  const normalized = hex.startsWith("#") ? hex : `#${hex}`;
  const parsed = parse(normalized);
  if (!parsed) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const result = oklch(parsed);
  if (!result) {
    throw new Error(`Could not convert to OKLCH: ${hex}`);
  }
  return {
    l: result.l ?? 0,
    c: result.c ?? 0,
    h: result.h ?? 0,
  };
}

/**
 * Convert an OKLCH color back to a hex string.
 * Clamps values before conversion to ensure valid output.
 */
export function oklchToHex(color: OklchColor): string {
  const clamped = clampOklch(color);
  const culoriColor: Oklch = {
    mode: "oklch",
    l: clamped.l,
    c: clamped.c,
    h: clamped.h,
  };
  const hex = formatHex(culoriColor);
  if (!hex) {
    throw new Error(
      `Could not convert OKLCH to hex: L=${color.l} C=${color.c} H=${color.h}`
    );
  }
  return hex;
}

// ─── Distance ────────────────────────────────────────────────────────────────

/**
 * Compute perceptual distance between two OKLCH colors.
 * Uses Euclidean distance in OKLCH space with lightness weighted 2x,
 * since human vision is more sensitive to lightness differences.
 */
export function perceptualDistance(a: OklchColor, b: OklchColor): number {
  const dL = a.l - b.l;
  const dC = a.c - b.c;

  // Hue difference needs special handling because hue is circular (0-360)
  let dH = a.h - b.h;
  if (dH > 180) dH -= 360;
  if (dH < -180) dH += 360;
  // Normalize hue difference to be on a similar scale as L and C
  const dHNorm = dH / 360;

  // Weight lightness 2x
  return Math.sqrt(4 * dL * dL + dC * dC + dHNorm * dHNorm);
}

/**
 * Compute raw Euclidean distance using culori's built-in function.
 * Useful for comparison/validation. No custom weighting.
 */
export function culoriDistance(a: OklchColor, b: OklchColor): number {
  const dist = differenceEuclidean("oklch");
  return dist(
    { mode: "oklch", l: a.l, c: a.c, h: a.h },
    { mode: "oklch", l: b.l, c: b.c, h: b.h }
  );
}

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Compute the min/max lightness and chroma ranges across a palette.
 * This defines the palette's structural space.
 */
export function normalizePalette(palette: OklchColor[]): NormalizedPalette {
  if (palette.length === 0) {
    return { minL: 0, maxL: 1, minC: 0, maxC: 0.4 };
  }

  let minL = Infinity;
  let maxL = -Infinity;
  let minC = Infinity;
  let maxC = -Infinity;

  for (const color of palette) {
    if (color.l < minL) minL = color.l;
    if (color.l > maxL) maxL = color.l;
    if (color.c < minC) minC = color.c;
    if (color.c > maxC) maxC = color.c;
  }

  return { minL, maxL, minC, maxC };
}

/**
 * Normalize a color's L and C within its palette's range.
 * Returns values in [0, 1] representing structural position.
 * If the palette has no range (all same L or C), returns 0.5.
 */
export function normalizeColor(
  color: OklchColor,
  palette: NormalizedPalette
): NormalizedPosition {
  const rangeL = palette.maxL - palette.minL;
  const rangeC = palette.maxC - palette.minC;

  return {
    normalized_L: rangeL > 0 ? (color.l - palette.minL) / rangeL : 0.5,
    normalized_C: rangeC > 0 ? (color.c - palette.minC) / rangeC : 0.5,
  };
}

// ─── Achromatic Detection ────────────────────────────────────────────────────

/** Chroma threshold below which a color is considered achromatic (black, white, grey) */
export const ACHROMATIC_THRESHOLD = 0.05;

/**
 * Detect whether a color is achromatic (black, white, or grey).
 * Achromatic colors have very low chroma — they carry no meaningful hue
 * and should not participate in palette-based color mapping.
 */
export function isAchromatic(color: OklchColor): boolean {
  return color.c < ACHROMATIC_THRESHOLD;
}

// ─── Warm/Cool Classification ────────────────────────────────────────────────

/**
 * Classify a color as warm or cool based on its hue.
 * Warm: hue in [0°, 60°] ∪ [330°, 360°] — reds, oranges, yellows, warm pinks
 * Cool: hue in (60°, 330°) — greens, blues, purples, cool pinks
 *
 * Achromatic colors (very low chroma) default to false (cool).
 */
export function isWarm(color: OklchColor): boolean {
  // Achromatic colors have no meaningful hue
  if (color.c < 0.01) return false;

  const h = ((color.h % 360) + 360) % 360; // normalize to [0, 360)
  return h <= 60 || h >= 330;
}

// ─── Feature Vector ──────────────────────────────────────────────────────────

/**
 * Compute the 6-dimensional feature vector for a color within a palette.
 *
 * [L, C, H, normalized_L, normalized_C, is_warm]
 *
 * Raw OKLCH values give the model absolute color information.
 * Normalized features capture structural role within the palette.
 * is_warm provides a binary warm/cool signal.
 */
export function computeFeatureVector(
  color: OklchColor,
  palette: NormalizedPalette
): FeatureVector {
  const norm = normalizeColor(color, palette);
  return [
    color.l,
    color.c,
    color.h / 360, // normalize hue to [0, 1] for ML input
    norm.normalized_L,
    norm.normalized_C,
    isWarm(color) ? 1 : 0,
  ];
}

// ─── Offsets ─────────────────────────────────────────────────────────────────

/**
 * Compute the offset from a base color to another color.
 * Used to preserve shade relationships within a color family.
 */
export function computeOffset(
  color: OklchColor,
  base: OklchColor
): OklchOffset {
  let dH = color.h - base.h;
  // Normalize hue difference to [-180, 180]
  if (dH > 180) dH -= 360;
  if (dH < -180) dH += 360;

  return {
    dL: color.l - base.l,
    dC: color.c - base.c,
    dH,
  };
}

/**
 * Apply an offset to a base color to generate a shade.
 * This is the naive shade generation for v1 (before ML is integrated).
 */
export function applyOffset(
  base: OklchColor,
  offset: OklchOffset
): OklchColor {
  return clampOklch({
    l: base.l + offset.dL,
    c: base.c + offset.dC,
    h: base.h + offset.dH,
  });
}

// ─── Clamping ────────────────────────────────────────────────────────────────

/**
 * Clamp OKLCH values to valid ranges.
 * L: [0, 1], C: [0, 0.4], H: [0, 360)
 */
export function clampOklch(color: OklchColor): OklchColor {
  return {
    l: Math.max(0, Math.min(1, color.l)),
    c: Math.max(0, Math.min(0.4, color.c)),
    h: ((color.h % 360) + 360) % 360,
  };
}
