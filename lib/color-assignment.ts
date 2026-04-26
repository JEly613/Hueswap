// lib/color-assignment.ts — Color family clustering + feature extraction
// Clusters SVG colors into families using perceptual distance in OKLCH space
// Computes 6D feature vectors and handles naive palette mapping for v1

import {
  hexToOklch,
  perceptualDistance,
  normalizePalette,
  normalizeColor,
  computeFeatureVector,
  computeOffset,
  applyOffset,
  oklchToHex,
} from "./color-math";
import type {
  OklchColor,
  OklchOffset,
  FeatureVector,
  NormalizedPalette,
} from "./color-math";
import type { ExtractedColor } from "./svg-parser";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ColorFamily {
  /** The representative base color for this family */
  base: ExtractedColor;
  /** Base color in OKLCH space */
  baseOklch: OklchColor;
  /** All member colors (including the base) */
  members: ExtractedColor[];
  /** Offsets from base for each non-base member (keyed by hex) */
  offsets: Map<string, OklchOffset>;
  /** 6D feature vector of the base color */
  featureVector: FeatureVector;
}

export interface ClusteringResult {
  /** Color families found in the SVG */
  families: ColorFamily[];
  /** Normalized palette info for the SVG's color space */
  normalizedPalette: NormalizedPalette;
  /** Warning if families exceed target palette size */
  warning: string | null;
}

export interface ColorMapping {
  /** Source color family */
  sourceFamily: ColorFamily;
  /** Target palette color in OKLCH */
  targetBaseOklch: OklchColor;
  /** Target palette color as hex */
  targetBaseHex: string;
  /** Full color map: source hex → target hex (including shades) */
  colorMap: Map<string, string>;
}

export interface MappingResult {
  /** All mappings from source families to target colors */
  mappings: ColorMapping[];
  /** Complete color map for the SVG rewriter */
  fullColorMap: Map<string, string>;
  /** Warning messages */
  warnings: string[];
}

// ─── Clustering ──────────────────────────────────────────────────────────────

/**
 * Distance threshold for grouping colors into the same family.
 * Colors within this perceptual distance are considered shades of the same hue.
 * Tuned for OKLCH space with our weighted distance function.
 */
const CLUSTER_THRESHOLD = 0.15;

/**
 * Cluster extracted SVG colors into perceptually similar families.
 *
 * Algorithm:
 * 1. Convert all colors to OKLCH
 * 2. Sort by area (largest first) so dominant colors become bases
 * 3. Greedily assign each color to the nearest existing family if within threshold
 * 4. Otherwise, start a new family with this color as base
 *
 * The base of each family is the color with the largest total area in that family.
 */
export function clusterColors(
  colors: ExtractedColor[],
  targetPaletteSize: number = 4
): ClusteringResult {
  if (colors.length === 0) {
    return {
      families: [],
      normalizedPalette: { minL: 0, maxL: 1, minC: 0, maxC: 0.4 },
      warning: null,
    };
  }

  // Convert all to OKLCH
  const oklchColors = colors.map((c) => ({
    extracted: c,
    oklch: hexToOklch(c.hex),
  }));

  // Sort by area descending — dominant colors first
  oklchColors.sort((a, b) => b.extracted.area - a.extracted.area);

  // Greedy clustering
  const clusters: {
    members: { extracted: ExtractedColor; oklch: OklchColor }[];
  }[] = [];

  for (const color of oklchColors) {
    let assigned = false;

    for (const cluster of clusters) {
      // Check distance to the first member (current base candidate)
      const baseDist = perceptualDistance(color.oklch, cluster.members[0].oklch);
      if (baseDist < CLUSTER_THRESHOLD) {
        cluster.members.push(color);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      clusters.push({ members: [color] });
    }
  }

  // Build color families
  // Compute the normalized palette from all base colors
  const baseOklchColors = clusters.map((c) => c.members[0].oklch);
  const normalizedPalette = normalizePalette(baseOklchColors);

  const families: ColorFamily[] = clusters.map((cluster) => {
    // Base is the member with largest area (already sorted, so first)
    const base = cluster.members[0];
    const members = cluster.members.map((m) => m.extracted);

    // Compute offsets for non-base members
    const offsets = new Map<string, OklchOffset>();
    for (const member of cluster.members.slice(1)) {
      offsets.set(
        member.extracted.hex,
        computeOffset(member.oklch, base.oklch)
      );
    }

    // Compute feature vector for the base
    const featureVector = computeFeatureVector(base.oklch, normalizedPalette);

    return {
      base: base.extracted,
      baseOklch: base.oklch,
      members,
      offsets,
      featureVector,
    };
  });

  // Warning if more families than target palette colors
  const warning =
    families.length > targetPaletteSize
      ? `Design has ${families.length} color families but target palette only has ${targetPaletteSize} colors. Some families will share a palette color.`
      : null;

  return { families, normalizedPalette, warning };
}

// ─── Naive Mapping (v1 — before ML) ─────────────────────────────────────────

/**
 * Compute structural similarity between two feature vectors.
 * Uses the normalized structural components (normalized_L, normalized_C, is_warm)
 * to find the best role match across palettes.
 *
 * Lower = more similar.
 */
function structuralDistance(a: FeatureVector, b: FeatureVector): number {
  // Compare normalized_L (index 3), normalized_C (index 4), is_warm (index 5)
  const dL = a[3] - b[3];
  const dC = a[4] - b[4];
  const dWarm = a[5] - b[5]; // 0 or ±1

  // Weight warm/cool mismatch heavily
  return Math.sqrt(dL * dL + dC * dC + dWarm * dWarm * 0.5);
}

/**
 * Naive normalized position transfer — the baseline mapping strategy.
 *
 * For each source color family, find the target palette color with the
 * closest normalized structural position (role vector similarity).
 *
 * This is what the ML model must beat.
 */
export function naiveMapping(
  clusterResult: ClusteringResult,
  targetPaletteHexes: string[]
): MappingResult {
  const { families, normalizedPalette: srcPalette } = clusterResult;
  const warnings: string[] = [];

  if (clusterResult.warning) {
    warnings.push(clusterResult.warning);
  }

  // Convert target palette to OKLCH and compute feature vectors
  const targetColors = targetPaletteHexes.map((hex) => hexToOklch(hex));
  const targetPalette = normalizePalette(targetColors);
  const targetFeatures = targetColors.map((c) =>
    computeFeatureVector(c, targetPalette)
  );

  // Track which target colors have been assigned (prefer unique assignments)
  const assignedTargets = new Set<number>();

  const mappings: ColorMapping[] = [];
  const fullColorMap = new Map<string, string>();

  // Sort families by area (most dominant first) for priority assignment
  const sortedFamilies = [...families].sort(
    (a, b) => b.base.area - a.base.area
  );

  for (const family of sortedFamilies) {
    // Find best matching target color by structural distance
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < targetFeatures.length; i++) {
      const dist = structuralDistance(family.featureVector, targetFeatures[i]);

      // Prefer unassigned targets (add penalty for already-assigned)
      const penalty = assignedTargets.has(i) ? 0.3 : 0;
      const adjustedDist = dist + penalty;

      if (adjustedDist < bestDist) {
        bestDist = adjustedDist;
        bestIdx = i;
      }
    }

    assignedTargets.add(bestIdx);

    const targetBaseOklch = targetColors[bestIdx];
    const targetBaseHex = targetPaletteHexes[bestIdx];

    // Build color map for this family
    const colorMap = new Map<string, string>();

    // Map the base color
    colorMap.set(family.base.hex, targetBaseHex);
    fullColorMap.set(family.base.hex, targetBaseHex);

    // Map shade members using offsets
    for (const member of family.members) {
      if (member.hex === family.base.hex) continue;

      const offset = family.offsets.get(member.hex);
      if (offset) {
        const shade = applyOffset(targetBaseOklch, offset);
        const shadeHex = oklchToHex(shade);
        colorMap.set(member.hex, shadeHex);
        fullColorMap.set(member.hex, shadeHex);
      }
    }

    mappings.push({
      sourceFamily: family,
      targetBaseOklch,
      targetBaseHex,
      colorMap,
    });
  }

  return { mappings, fullColorMap, warnings };
}
