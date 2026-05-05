// app/api/recolor/route.ts — Main pipeline endpoint
// Orchestrates: parse → cluster → map → rewrite
// Supports ML inference via INFERENCE_URL env var, falls back to naive mapping.

import { parseSvg } from "@/lib/svg-parser";
import { clusterColors, naiveMapping } from "@/lib/color-assignment";
import { recolorSvg } from "@/lib/svg-rewriter";
import {
  hexToOklch,
  oklchToHex,
  applyOffset,
  normalizePalette,
  computeFeatureVector,
  isWarm,
} from "@/lib/color-math";
import type { OklchColor } from "@/lib/color-math";
import type { ClusteringResult, MappingResult } from "@/lib/color-assignment";

export interface RecolorRequest {
  /** Raw SVG string */
  svg: string;
  /** Target palette as 4 hex strings */
  palette: string[];
}

export interface FamilyInfo {
  baseHex: string;
  memberHexes: string[];
  targetHex: string;
  featureVector: number[];
}

export interface RecolorResponse {
  /** The recolored SVG string (primary mapping — warm/cool aware) */
  recoloredSvg: string;
  /** Alternative recolored SVG (pure OKLCH distance, no temperature penalty) */
  alternativeSvg?: string;
  /** Original extracted colors */
  originalColors: string[];
  /** Color family → target mapping info for the primary mapping */
  families: FamilyInfo[];
  /** Color family → target mapping info for the alternative mapping */
  alternativeFamilies?: FamilyInfo[];
  /** Full color map (source hex → target hex) */
  colorMap: Record<string, string>;
  /** Any warnings (e.g. more families than palette colors) */
  warnings: string[];
}

/** Timeout in ms for inference service requests */
const INFERENCE_TIMEOUT_MS = 5000;

/**
 * Call the inference service to predict a target OKLCH color for a source family.
 * Returns null on any failure (network error, timeout, non-200 response, bad data).
 */
async function callInference(
  inferenceUrl: string,
  sourcePaletteHexes: string[],
  targetPaletteHexes: string[],
  sourceFeatures: number[]
): Promise<OklchColor | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

  try {
    const response = await fetch(`${inferenceUrl}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_palette: sourcePaletteHexes,
        target_palette: targetPaletteHexes,
        source_features: sourceFeatures,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { oklch?: number[] };
    if (
      !data.oklch ||
      !Array.isArray(data.oklch) ||
      data.oklch.length !== 3 ||
      data.oklch.some((v) => typeof v !== "number" || isNaN(v))
    ) {
      return null;
    }

    const [L, C, H_deg] = data.oklch;
    return { l: L, c: C, h: H_deg };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hungarian algorithm (Munkres) for optimal assignment.
 * Given an n×m cost matrix, finds the assignment of rows to columns
 * that minimizes total cost. Returns array of [row, col] pairs.
 * Handles non-square matrices by padding with zeros.
 */
function hungarianAssignment(costMatrix: number[][]): [number, number][] {
  const nRows = costMatrix.length;
  const nCols = costMatrix[0]?.length ?? 0;
  const n = Math.max(nRows, nCols);

  // Pad to square matrix
  const C: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i < nRows && j < nCols ? costMatrix[i][j] : 0
    )
  );

  // Step 1: Subtract row minimums
  for (let i = 0; i < n; i++) {
    const rowMin = Math.min(...C[i]);
    for (let j = 0; j < n; j++) C[i][j] -= rowMin;
  }

  // Step 2: Subtract column minimums
  for (let j = 0; j < n; j++) {
    let colMin = Infinity;
    for (let i = 0; i < n; i++) if (C[i][j] < colMin) colMin = C[i][j];
    for (let i = 0; i < n; i++) C[i][j] -= colMin;
  }

  // Iterative assignment
  const rowAssign = new Array<number>(n).fill(-1);
  const colAssign = new Array<number>(n).fill(-1);

  for (let iter = 0; iter < n * n; iter++) {
    // Try to find a complete assignment using augmenting paths
    const match = new Array<number>(n).fill(-1);
    const colMatch = new Array<number>(n).fill(-1);

    let matched = 0;
    for (let i = 0; i < n; i++) {
      const visited = new Array<boolean>(n).fill(false);
      if (augment(i, C, match, colMatch, visited, n)) matched++;
    }

    if (matched === n) {
      // Complete assignment found
      const result: [number, number][] = [];
      for (let i = 0; i < nRows; i++) {
        if (match[i] < nCols) result.push([i, match[i]]);
      }
      return result;
    }

    // Find minimum uncovered value and adjust
    const rowCovered = new Array<boolean>(n).fill(false);
    const colCovered = new Array<boolean>(n).fill(false);

    // Mark rows that have a match
    for (let i = 0; i < n; i++) if (match[i] !== -1) rowCovered[i] = true;

    // Iteratively find uncovered zeros and adjust covers
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < n; i++) {
        if (rowCovered[i]) continue;
        for (let j = 0; j < n; j++) {
          if (colCovered[j]) continue;
          if (C[i][j] === 0) {
            colCovered[j] = true;
            changed = true;
          }
        }
      }
      for (let j = 0; j < n; j++) {
        if (!colCovered[j]) continue;
        for (let i = 0; i < n; i++) {
          if (!rowCovered[i]) continue;
          if (colMatch[j] === i) {
            rowCovered[i] = false;
            changed = true;
          }
        }
      }
    }

    // Find min uncovered
    let minVal = Infinity;
    for (let i = 0; i < n; i++) {
      if (rowCovered[i]) continue;
      for (let j = 0; j < n; j++) {
        if (colCovered[j]) continue;
        if (C[i][j] < minVal) minVal = C[i][j];
      }
    }

    if (minVal === Infinity || minVal === 0) break;

    // Subtract from uncovered, add to doubly-covered
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (!rowCovered[i] && !colCovered[j]) C[i][j] -= minVal;
        else if (rowCovered[i] && colCovered[j]) C[i][j] += minVal;
      }
    }
  }

  // Fallback: use whatever matching we can find
  const finalMatch = new Array<number>(n).fill(-1);
  const finalColMatch = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const visited = new Array<boolean>(n).fill(false);
    augment(i, C, finalMatch, finalColMatch, visited, n);
  }

  const result: [number, number][] = [];
  for (let i = 0; i < nRows; i++) {
    if (finalMatch[i] >= 0 && finalMatch[i] < nCols) result.push([i, finalMatch[i]]);
  }
  return result;
}

function augment(
  row: number,
  C: number[][],
  match: number[],
  colMatch: number[],
  visited: boolean[],
  n: number
): boolean {
  for (let j = 0; j < n; j++) {
    if (C[row][j] === 0 && !visited[j]) {
      visited[j] = true;
      if (colMatch[j] === -1 || augment(colMatch[j], C, match, colMatch, visited, n)) {
        match[row] = j;
        colMatch[j] = row;
        return true;
      }
    }
  }
  return false;
}

/** Compute OKLCH distance between two colors (weighted, hue-aware) */
function oklchDistance(a: OklchColor, b: OklchColor): number {
  const dL = a.l - b.l;
  const dC = a.c - b.c;
  let dH = a.h - b.h;
  if (dH > 180) dH -= 360;
  if (dH < -180) dH += 360;
  return Math.sqrt(2 * dL * dL + dC * dC + (dH / 360) * (dH / 360));
}

/**
 * ML-assisted mapping with Hungarian (optimal) assignment.
 *
 * 1. Collect ML predictions for all families
 * 2. Build a cost matrix: cost[family_i][palette_j] = distance(prediction_i, palette_j)
 *    + optional warm/cool mismatch penalty
 * 3. Solve with Hungarian algorithm for globally optimal bijective assignment
 * 4. Apply shade offsets from the assigned palette color
 *
 * Falls back to naive structural matching for any family where ML fails.
 */
async function mlMapping(
  clusterResult: ClusteringResult,
  targetPaletteHexes: string[],
  inferenceUrl: string,
  useTemperaturePenalty: boolean,
  cachedPredictions?: (OklchColor | null)[]
): Promise<{ result: MappingResult; predictions: (OklchColor | null)[] }> {
  const { families, achromaticColors } = clusterResult;
  const warnings: string[] = [];

  if (clusterResult.warning) {
    warnings.push(clusterResult.warning);
  }

  // Build the source palette hex list (4 family base colors, padded if needed)
  const firstHex = families.length > 0 ? families[0].base.hex : "#000000";
  const sourcePaletteHexes: string[] = families.map((f) => f.base.hex);
  while (sourcePaletteHexes.length < 4) {
    sourcePaletteHexes.push(firstHex);
  }

  // Convert target palette to OKLCH
  const targetColors = targetPaletteHexes.map((hex) => hexToOklch(hex));

  // Achromatic colors pass through unchanged
  const fullColorMap = new Map<string, string>();
  for (const ac of achromaticColors) {
    fullColorMap.set(ac.hex, ac.hex);
  }

  // Sort families by area (most dominant first)
  const sortedFamilies = [...families].sort(
    (a, b) => b.base.area - a.base.area
  );

  // Phase 1: Collect all ML predictions (or reuse cached ones)
  const predictions: (OklchColor | null)[] = cachedPredictions ?? [];
  let anyMlFailure = false;

  if (!cachedPredictions) {
    for (const family of sortedFamilies) {
      const sourceFeatures = Array.from(family.featureVector);
      const predicted = await callInference(
        inferenceUrl,
        sourcePaletteHexes,
        targetPaletteHexes,
        sourceFeatures
      );
      predictions.push(predicted);
      if (predicted === null) anyMlFailure = true;
    }
  } else {
    anyMlFailure = cachedPredictions.some((p) => p === null);
  }

  // Phase 2: Build cost matrix and solve assignment with Hungarian algorithm
  // For families with ML predictions: cost = distance(prediction, palette_color)
  // For families without: cost = structural distance (Role_Vector)
  // A warm/cool mismatch penalty ensures temperature is preserved (warm→warm, cool→cool)
  const nFamilies = sortedFamilies.length;
  const nTargets = targetColors.length;

  const WARM_COOL_PENALTY = 0.5;

  const costMatrix: number[][] = [];
  const targetPalette = normalizePalette(targetColors);
  const targetFeatures = targetColors.map((c) =>
    computeFeatureVector(c, targetPalette)
  );

  for (let i = 0; i < nFamilies; i++) {
    const row: number[] = [];
    const srcIsWarm = sortedFamilies[i].featureVector[5]; // is_warm at index 5

    for (let j = 0; j < nTargets; j++) {
      const tgtIsWarm = isWarm(targetColors[j]) ? 1 : 0;
      const tempPenalty =
        useTemperaturePenalty && srcIsWarm !== tgtIsWarm ? WARM_COOL_PENALTY : 0;

      if (predictions[i] !== null) {
        // ML prediction available: use OKLCH distance from prediction to palette color
        row.push(oklchDistance(predictions[i]!, targetColors[j]) + tempPenalty);
      } else {
        // No ML prediction: use structural distance (Role_Vector)
        const sf = sortedFamilies[i].featureVector;
        const tf = targetFeatures[j];
        const dL = sf[3] - tf[3];
        const dC = sf[4] - tf[4];
        const dWarm = sf[5] - tf[5];
        row.push(Math.sqrt(dL * dL + dC * dC + dWarm * dWarm * 0.5) + tempPenalty);
      }
    }
    costMatrix.push(row);
  }

  // Solve optimal assignment
  const assignments = hungarianAssignment(costMatrix);

  // Build a map from family index to target palette index
  const familyToTarget = new Map<number, number>();
  for (const [famIdx, tgtIdx] of assignments) {
    familyToTarget.set(famIdx, tgtIdx);
  }

  // Phase 3: Apply assignments and build color maps
  const mappings: MappingResult["mappings"] = [];

  for (let i = 0; i < nFamilies; i++) {
    const family = sortedFamilies[i];
    const tgtIdx = familyToTarget.get(i) ?? 0;

    const targetBaseOklch = targetColors[tgtIdx];
    const targetBaseHex = targetPaletteHexes[tgtIdx];

    const colorMap = new Map<string, string>();
    colorMap.set(family.base.hex, targetBaseHex);
    fullColorMap.set(family.base.hex, targetBaseHex);

    // Apply shade offsets
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

    mappings.push({ sourceFamily: family, targetBaseOklch, targetBaseHex, colorMap });
  }

  if (anyMlFailure) {
    warnings.push(
      "ML inference failed for one or more color families; structural matching was used as fallback."
    );
  }

  return {
    result: { mappings, fullColorMap, warnings },
    predictions,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RecolorRequest;

    // Validate input
    if (!body.svg || typeof body.svg !== "string") {
      return Response.json(
        { error: "Missing or invalid 'svg' field" },
        { status: 400 }
      );
    }

    if (
      !body.palette ||
      !Array.isArray(body.palette) ||
      body.palette.length === 0
    ) {
      return Response.json(
        { error: "Missing or invalid 'palette' field (expected array of hex strings)" },
        { status: 400 }
      );
    }

    // Validate hex format
    const hexRegex = /^#?[0-9a-fA-F]{6}$/;
    const normalizedPalette = body.palette.map((hex) => {
      const h = hex.startsWith("#") ? hex : `#${hex}`;
      if (!hexRegex.test(h)) {
        throw new Error(`Invalid hex color: ${hex}`);
      }
      return h.toLowerCase();
    });

    // Step 1: Parse SVG and extract colors
    const { colors } = parseSvg(body.svg);

    if (colors.length === 0) {
      return Response.json({
        recoloredSvg: body.svg,
        originalColors: [],
        families: [],
        colorMap: {},
        warnings: ["No colors found in SVG"],
      } satisfies RecolorResponse);
    }

    // Step 2: Cluster colors into families
    const clusterResult = clusterColors(colors, normalizedPalette.length);

    // Step 3: Map families to target palette (ML or naive)
    const inferenceUrl = process.env.INFERENCE_URL;
    let mappingResult: MappingResult;
    let alternativeMappingResult: MappingResult | null = null;

    if (inferenceUrl) {
      // Primary: ML with warm/cool temperature penalty
      const { result: primary } = await mlMapping(
        clusterResult,
        normalizedPalette,
        inferenceUrl,
        true
      );
      mappingResult = primary;

      // Alternative: naive structural mapping (Role_Vector, no ML)
      // Always different from ML — gives user a meaningful A/B choice
      const naive = naiveMapping(clusterResult, normalizedPalette);
      const primaryKeys = JSON.stringify(primary.mappings.map((m) => m.targetBaseHex));
      const naiveKeys = JSON.stringify(naive.mappings.map((m) => m.targetBaseHex));
      if (primaryKeys !== naiveKeys) {
        alternativeMappingResult = naive;
      }
    } else {
      mappingResult = naiveMapping(clusterResult, normalizedPalette);
    }

    // Step 4: Rewrite SVG with the color map
    const recoloredSvg = recolorSvg(body.svg, mappingResult.fullColorMap);
    const alternativeSvg = alternativeMappingResult
      ? recolorSvg(body.svg, alternativeMappingResult.fullColorMap)
      : undefined;

    // Build response
    const families: FamilyInfo[] = mappingResult.mappings.map((m) => ({
      baseHex: m.sourceFamily.base.hex,
      memberHexes: m.sourceFamily.members.map((mem) => mem.hex),
      targetHex: m.targetBaseHex,
      featureVector: Array.from(m.sourceFamily.featureVector),
    }));

    const alternativeFamilies: FamilyInfo[] | undefined = alternativeMappingResult?.mappings.map((m) => ({
      baseHex: m.sourceFamily.base.hex,
      memberHexes: m.sourceFamily.members.map((mem) => mem.hex),
      targetHex: m.targetBaseHex,
      featureVector: Array.from(m.sourceFamily.featureVector),
    }));

    const colorMap: Record<string, string> = {};
    for (const [src, tgt] of mappingResult.fullColorMap) {
      colorMap[src] = tgt;
    }

    const response: RecolorResponse = {
      recoloredSvg,
      alternativeSvg,
      originalColors: colors.map((c) => c.hex),
      families,
      alternativeFamilies,
      colorMap,
      warnings: mappingResult.warnings,
    };

    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
