import { describe, it, expect } from "vitest";
import {
  hexToOklch,
  oklchToHex,
  perceptualDistance,
  normalizePalette,
  normalizeColor,
  isWarm,
  computeFeatureVector,
  computeOffset,
  applyOffset,
  clampOklch,
} from "../color-math";
import type { OklchColor, NormalizedPalette } from "../color-math";

// ─── hexToOklch ──────────────────────────────────────────────────────────────

describe("hexToOklch", () => {
  it("converts pure white", () => {
    const result = hexToOklch("#ffffff");
    expect(result.l).toBeCloseTo(1, 1);
    expect(result.c).toBeCloseTo(0, 2);
  });

  it("converts pure black", () => {
    const result = hexToOklch("#000000");
    expect(result.l).toBeCloseTo(0, 1);
    expect(result.c).toBeCloseTo(0, 2);
  });

  it("converts a red", () => {
    const result = hexToOklch("#ff0000");
    expect(result.l).toBeGreaterThan(0.4);
    expect(result.c).toBeGreaterThan(0.15);
    // Red hue should be roughly in the 20-30° range in OKLCH
    expect(result.h).toBeGreaterThan(10);
    expect(result.h).toBeLessThan(40);
  });

  it("handles hex without #", () => {
    const with_ = hexToOklch("#3366cc");
    const without = hexToOklch("3366cc");
    expect(with_.l).toBeCloseTo(without.l, 5);
    expect(with_.c).toBeCloseTo(without.c, 5);
    expect(with_.h).toBeCloseTo(without.h, 5);
  });

  it("throws on invalid hex", () => {
    expect(() => hexToOklch("not-a-color")).toThrow();
  });
});

// ─── oklchToHex ──────────────────────────────────────────────────────────────

describe("oklchToHex", () => {
  it("roundtrips common colors", () => {
    const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#000000"];
    for (const hex of colors) {
      const oklch = hexToOklch(hex);
      const result = oklchToHex(oklch);
      // Roundtrip should be close (may not be exact due to gamut mapping)
      expect(result).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("clamps out-of-range values", () => {
    const result = oklchToHex({ l: 1.5, c: 0.5, h: 400 });
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ─── perceptualDistance ──────────────────────────────────────────────────────

describe("perceptualDistance", () => {
  it("returns 0 for identical colors", () => {
    const color: OklchColor = { l: 0.5, c: 0.15, h: 180 };
    expect(perceptualDistance(color, color)).toBe(0);
  });

  it("returns larger distance for more different colors", () => {
    const a: OklchColor = { l: 0.9, c: 0.05, h: 60 };
    const b: OklchColor = { l: 0.5, c: 0.15, h: 180 };
    const c: OklchColor = { l: 0.85, c: 0.06, h: 65 };

    const distAB = perceptualDistance(a, b);
    const distAC = perceptualDistance(a, c);
    expect(distAB).toBeGreaterThan(distAC);
  });

  it("weights lightness more heavily", () => {
    const base: OklchColor = { l: 0.5, c: 0.15, h: 180 };
    const lighterOnly: OklchColor = { l: 0.6, c: 0.15, h: 180 };
    const chromaOnly: OklchColor = { l: 0.5, c: 0.25, h: 180 };

    const distL = perceptualDistance(base, lighterOnly);
    const distC = perceptualDistance(base, chromaOnly);
    // Same numeric difference (0.1) but lightness should produce larger distance
    expect(distL).toBeGreaterThan(distC);
  });

  it("handles hue wrapping (350° vs 10°)", () => {
    const a: OklchColor = { l: 0.5, c: 0.15, h: 350 };
    const b: OklchColor = { l: 0.5, c: 0.15, h: 10 };
    const dist = perceptualDistance(a, b);
    // Should be a small distance (20° hue difference), not 340°
    expect(dist).toBeLessThan(0.1);
  });
});

// ─── normalizePalette ────────────────────────────────────────────────────────

describe("normalizePalette", () => {
  it("computes correct ranges", () => {
    const palette: OklchColor[] = [
      { l: 0.2, c: 0.05, h: 30 },
      { l: 0.8, c: 0.25, h: 200 },
      { l: 0.5, c: 0.15, h: 120 },
    ];
    const result = normalizePalette(palette);
    expect(result.minL).toBeCloseTo(0.2);
    expect(result.maxL).toBeCloseTo(0.8);
    expect(result.minC).toBeCloseTo(0.05);
    expect(result.maxC).toBeCloseTo(0.25);
  });

  it("handles empty palette with defaults", () => {
    const result = normalizePalette([]);
    expect(result.minL).toBe(0);
    expect(result.maxL).toBe(1);
  });

  it("handles single-color palette", () => {
    const result = normalizePalette([{ l: 0.5, c: 0.1, h: 90 }]);
    expect(result.minL).toBe(result.maxL);
    expect(result.minC).toBe(result.maxC);
  });
});

// ─── normalizeColor ──────────────────────────────────────────────────────────

describe("normalizeColor", () => {
  it("normalizes to [0, 1] range", () => {
    const palette: NormalizedPalette = {
      minL: 0.2,
      maxL: 0.8,
      minC: 0.05,
      maxC: 0.25,
    };
    const color: OklchColor = { l: 0.5, c: 0.15, h: 100 };
    const result = normalizeColor(color, palette);
    expect(result.normalized_L).toBeCloseTo(0.5); // (0.5-0.2)/(0.8-0.2) = 0.5
    expect(result.normalized_C).toBeCloseTo(0.5); // (0.15-0.05)/(0.25-0.05) = 0.5
  });

  it("returns 0 for darkest/most muted", () => {
    const palette: NormalizedPalette = {
      minL: 0.2,
      maxL: 0.8,
      minC: 0.05,
      maxC: 0.25,
    };
    const color: OklchColor = { l: 0.2, c: 0.05, h: 100 };
    const result = normalizeColor(color, palette);
    expect(result.normalized_L).toBeCloseTo(0);
    expect(result.normalized_C).toBeCloseTo(0);
  });

  it("returns 1 for lightest/most saturated", () => {
    const palette: NormalizedPalette = {
      minL: 0.2,
      maxL: 0.8,
      minC: 0.05,
      maxC: 0.25,
    };
    const color: OklchColor = { l: 0.8, c: 0.25, h: 100 };
    const result = normalizeColor(color, palette);
    expect(result.normalized_L).toBeCloseTo(1);
    expect(result.normalized_C).toBeCloseTo(1);
  });

  it("returns 0.5 when palette has no range", () => {
    const palette: NormalizedPalette = {
      minL: 0.5,
      maxL: 0.5,
      minC: 0.1,
      maxC: 0.1,
    };
    const color: OklchColor = { l: 0.5, c: 0.1, h: 100 };
    const result = normalizeColor(color, palette);
    expect(result.normalized_L).toBe(0.5);
    expect(result.normalized_C).toBe(0.5);
  });
});

// ─── isWarm ──────────────────────────────────────────────────────────────────

describe("isWarm", () => {
  it("classifies red as warm", () => {
    expect(isWarm({ l: 0.6, c: 0.2, h: 25 })).toBe(true);
  });

  it("classifies orange as warm", () => {
    expect(isWarm({ l: 0.7, c: 0.2, h: 50 })).toBe(true);
  });

  it("classifies yellow-edge as warm", () => {
    expect(isWarm({ l: 0.8, c: 0.15, h: 60 })).toBe(true);
  });

  it("classifies warm pink (340°) as warm", () => {
    expect(isWarm({ l: 0.6, c: 0.15, h: 340 })).toBe(true);
  });

  it("classifies blue as cool", () => {
    expect(isWarm({ l: 0.5, c: 0.2, h: 250 })).toBe(false);
  });

  it("classifies green as cool", () => {
    expect(isWarm({ l: 0.6, c: 0.15, h: 150 })).toBe(false);
  });

  it("classifies purple as cool", () => {
    expect(isWarm({ l: 0.4, c: 0.2, h: 300 })).toBe(false);
  });

  it("classifies achromatic (low chroma) as cool", () => {
    expect(isWarm({ l: 0.5, c: 0.005, h: 30 })).toBe(false);
  });
});

// ─── computeFeatureVector ────────────────────────────────────────────────────

describe("computeFeatureVector", () => {
  it("returns a 6-element array", () => {
    const palette: NormalizedPalette = {
      minL: 0.2,
      maxL: 0.8,
      minC: 0.05,
      maxC: 0.25,
    };
    const color: OklchColor = { l: 0.5, c: 0.15, h: 180 };
    const fv = computeFeatureVector(color, palette);
    expect(fv).toHaveLength(6);
  });

  it("has correct structure [L, C, H_norm, normL, normC, isWarm]", () => {
    const palette: NormalizedPalette = {
      minL: 0.2,
      maxL: 0.8,
      minC: 0.05,
      maxC: 0.25,
    };
    const color: OklchColor = { l: 0.5, c: 0.15, h: 30 }; // warm
    const fv = computeFeatureVector(color, palette);

    expect(fv[0]).toBeCloseTo(0.5); // L
    expect(fv[1]).toBeCloseTo(0.15); // C
    expect(fv[2]).toBeCloseTo(30 / 360); // H normalized to [0,1]
    expect(fv[3]).toBeCloseTo(0.5); // normalized_L
    expect(fv[4]).toBeCloseTo(0.5); // normalized_C
    expect(fv[5]).toBe(1); // is_warm
  });

  it("sets is_warm to 0 for cool colors", () => {
    const palette: NormalizedPalette = {
      minL: 0,
      maxL: 1,
      minC: 0,
      maxC: 0.3,
    };
    const color: OklchColor = { l: 0.5, c: 0.15, h: 250 }; // blue = cool
    const fv = computeFeatureVector(color, palette);
    expect(fv[5]).toBe(0);
  });
});

// ─── computeOffset / applyOffset ─────────────────────────────────────────────

describe("computeOffset and applyOffset", () => {
  it("roundtrips: apply(base, offset(color, base)) ≈ color", () => {
    const base: OklchColor = { l: 0.5, c: 0.15, h: 180 };
    const color: OklchColor = { l: 0.6, c: 0.2, h: 200 };

    const offset = computeOffset(color, base);
    const reconstructed = applyOffset(base, offset);

    expect(reconstructed.l).toBeCloseTo(color.l, 5);
    expect(reconstructed.c).toBeCloseTo(color.c, 5);
    expect(reconstructed.h).toBeCloseTo(color.h, 3);
  });

  it("handles hue wrapping in offset (350° to 10°)", () => {
    const base: OklchColor = { l: 0.5, c: 0.15, h: 350 };
    const color: OklchColor = { l: 0.5, c: 0.15, h: 10 };

    const offset = computeOffset(color, base);
    // Should be +20°, not -340°
    expect(offset.dH).toBeCloseTo(20, 1);
  });

  it("handles hue wrapping in offset (10° to 350°)", () => {
    const base: OklchColor = { l: 0.5, c: 0.15, h: 10 };
    const color: OklchColor = { l: 0.5, c: 0.15, h: 350 };

    const offset = computeOffset(color, base);
    // Should be -20°, not +340°
    expect(offset.dH).toBeCloseTo(-20, 1);
  });
});

// ─── clampOklch ──────────────────────────────────────────────────────────────

describe("clampOklch", () => {
  it("clamps L to [0, 1]", () => {
    expect(clampOklch({ l: -0.5, c: 0.1, h: 180 }).l).toBe(0);
    expect(clampOklch({ l: 1.5, c: 0.1, h: 180 }).l).toBe(1);
  });

  it("clamps C to [0, 0.4]", () => {
    expect(clampOklch({ l: 0.5, c: -0.1, h: 180 }).c).toBe(0);
    expect(clampOklch({ l: 0.5, c: 0.6, h: 180 }).c).toBe(0.4);
  });

  it("wraps H to [0, 360)", () => {
    expect(clampOklch({ l: 0.5, c: 0.1, h: -30 }).h).toBeCloseTo(330);
    expect(clampOklch({ l: 0.5, c: 0.1, h: 400 }).h).toBeCloseTo(40);
    expect(clampOklch({ l: 0.5, c: 0.1, h: 360 }).h).toBeCloseTo(0);
  });

  it("passes through valid values unchanged", () => {
    const color: OklchColor = { l: 0.5, c: 0.15, h: 180 };
    const clamped = clampOklch(color);
    expect(clamped.l).toBe(0.5);
    expect(clamped.c).toBe(0.15);
    expect(clamped.h).toBe(180);
  });
});

// ─── Integration: hex → OKLCH → feature vector → hex roundtrip ──────────────

describe("integration", () => {
  it("processes a real palette end-to-end", () => {
    // A colorhunt-style 4-color palette
    const hexPalette = ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"];

    // Convert to OKLCH
    const oklchPalette = hexPalette.map(hexToOklch);
    expect(oklchPalette).toHaveLength(4);

    // Compute normalized palette
    const normPalette = normalizePalette(oklchPalette);
    expect(normPalette.maxL).toBeGreaterThan(normPalette.minL);

    // Compute feature vectors
    const featureVectors = oklchPalette.map((c) =>
      computeFeatureVector(c, normPalette)
    );
    expect(featureVectors).toHaveLength(4);

    // Each feature vector should have 6 elements
    for (const fv of featureVectors) {
      expect(fv).toHaveLength(6);
      // L should be in [0, 1]
      expect(fv[0]).toBeGreaterThanOrEqual(0);
      expect(fv[0]).toBeLessThanOrEqual(1);
      // normalized_L should be in [0, 1]
      expect(fv[3]).toBeGreaterThanOrEqual(0);
      expect(fv[3]).toBeLessThanOrEqual(1);
      // is_warm should be 0 or 1
      expect([0, 1]).toContain(fv[5]);
    }

    // Convert back to hex
    const roundtripped = oklchPalette.map(oklchToHex);
    expect(roundtripped).toHaveLength(4);
    for (const hex of roundtripped) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
