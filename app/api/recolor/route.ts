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
  /** The recolored SVG string */
  recoloredSvg: string;
  /** Original extracted colors */
  originalColors: string[];
  /** Color family → target mapping info for the review UI */
  families: FamilyInfo[];
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
 * ML-assisted mapping: calls inference service for each family base color,
 * falls back to naive mapping on any failure.
 */
async function mlMapping(
  clusterResult: ClusteringResult,
  targetPaletteHexes: string[],
  inferenceUrl: string
): Promise<{ result: MappingResult; usedMl: boolean }> {
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

  // Convert target palette to OKLCH for shade offset application
  const targetColors = targetPaletteHexes.map((hex) => hexToOklch(hex));

  // Achromatic colors pass through unchanged
  const fullColorMap = new Map<string, string>();
  for (const ac of achromaticColors) {
    fullColorMap.set(ac.hex, ac.hex);
  }

  let anyMlFailure = false;
  const mappings: MappingResult["mappings"] = [];

  // Sort families by area (most dominant first) — same order as naiveMapping
  const sortedFamilies = [...families].sort(
    (a, b) => b.base.area - a.base.area
  );

  // Track assigned target indices to prefer unique assignments (same as naive)
  const assignedTargets = new Set<number>();

  for (const family of sortedFamilies) {
    const sourceFeatures = Array.from(family.featureVector);

    // Try ML prediction
    const predicted = await callInference(
      inferenceUrl,
      sourcePaletteHexes,
      targetPaletteHexes,
      sourceFeatures
    );

    if (predicted === null) {
      anyMlFailure = true;
      // Fall back to naive for this family: pick best target by structural distance
      const targetPalette = normalizePalette(targetColors);
      const targetFeatures = targetColors.map((c) =>
        computeFeatureVector(c, targetPalette)
      );

      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < targetFeatures.length; i++) {
        const tf = targetFeatures[i];
        const sf = family.featureVector;
        const dL = sf[3] - tf[3];
        const dC = sf[4] - tf[4];
        const dWarm = sf[5] - tf[5];
        const dist =
          Math.sqrt(dL * dL + dC * dC + dWarm * dWarm * 0.5) +
          (assignedTargets.has(i) ? 0.3 : 0);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      assignedTargets.add(bestIdx);

      const targetBaseOklch = targetColors[bestIdx];
      const targetBaseHex = targetPaletteHexes[bestIdx];
      const colorMap = new Map<string, string>();
      colorMap.set(family.base.hex, targetBaseHex);
      fullColorMap.set(family.base.hex, targetBaseHex);

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
      continue;
    }

    // ML success: use predicted OKLCH to select the closest actual palette color.
    // The model predicts what the target *should look like* — we snap to the
    // nearest real palette color so the output always uses the user's palette.
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < targetColors.length; i++) {
      const tc = targetColors[i];
      const dL = predicted.l - tc.l;
      const dC = predicted.c - tc.c;
      let dH = predicted.h - tc.h;
      if (dH > 180) dH -= 360;
      if (dH < -180) dH += 360;
      const dist =
        Math.sqrt(2 * dL * dL + dC * dC + (dH / 360) * (dH / 360)) +
        (assignedTargets.has(i) ? 0.3 : 0);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    assignedTargets.add(bestIdx);

    const targetBaseOklch = targetColors[bestIdx];
    const targetBaseHex = targetPaletteHexes[bestIdx];

    const colorMap = new Map<string, string>();
    colorMap.set(family.base.hex, targetBaseHex);
    fullColorMap.set(family.base.hex, targetBaseHex);

    // Apply shade offsets using the ML-predicted base
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
      "ML inference failed for one or more color families; naive mapping was used as fallback."
    );
  }

  return {
    result: { mappings, fullColorMap, warnings },
    usedMl: !anyMlFailure,
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

    if (inferenceUrl) {
      const { result, usedMl: _ } = await mlMapping(
        clusterResult,
        normalizedPalette,
        inferenceUrl
      );
      mappingResult = result;
    } else {
      mappingResult = naiveMapping(clusterResult, normalizedPalette);
    }

    // Step 4: Rewrite SVG with the color map
    const recoloredSvg = recolorSvg(body.svg, mappingResult.fullColorMap);

    // Build response
    const families: FamilyInfo[] = mappingResult.mappings.map((m) => ({
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
      originalColors: colors.map((c) => c.hex),
      families,
      colorMap,
      warnings: mappingResult.warnings,
    };

    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
