// app/api/recolor/route.ts — Main pipeline endpoint
// Orchestrates: parse → cluster → map → rewrite

import { parseSvg } from "@/lib/svg-parser";
import { clusterColors, naiveMapping } from "@/lib/color-assignment";
import { recolorSvg } from "@/lib/svg-rewriter";

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

    // Step 3: Map families to target palette (naive v1)
    const mappingResult = naiveMapping(clusterResult, normalizedPalette);

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
