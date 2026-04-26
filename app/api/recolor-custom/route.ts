// app/api/recolor-custom/route.ts — Recolor with user-defined mapping
// Used when the user adjusts color assignments in the review step

import { parseSvg } from "@/lib/svg-parser";
import { clusterColors } from "@/lib/color-assignment";
import { recolorSvg } from "@/lib/svg-rewriter";
import { hexToOklch, applyOffset, computeOffset, oklchToHex } from "@/lib/color-math";

export interface CustomRecolorRequest {
  /** Raw SVG string */
  svg: string;
  /** User-defined family → target mappings */
  mappings: {
    baseHex: string;
    memberHexes: string[];
    targetHex: string;
  }[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CustomRecolorRequest;

    if (!body.svg || typeof body.svg !== "string") {
      return Response.json(
        { error: "Missing or invalid 'svg' field" },
        { status: 400 }
      );
    }

    if (!body.mappings || !Array.isArray(body.mappings)) {
      return Response.json(
        { error: "Missing or invalid 'mappings' field" },
        { status: 400 }
      );
    }

    // Build the full color map from user-defined mappings
    const fullColorMap = new Map<string, string>();

    for (const mapping of body.mappings) {
      const targetOklch = hexToOklch(mapping.targetHex);

      // Map the base color directly
      fullColorMap.set(mapping.baseHex, mapping.targetHex);

      // Map member colors using offsets from the original base
      const baseOklch = hexToOklch(mapping.baseHex);
      for (const memberHex of mapping.memberHexes) {
        if (memberHex === mapping.baseHex) continue;

        const memberOklch = hexToOklch(memberHex);
        const offset = computeOffset(memberOklch, baseOklch);
        const shade = applyOffset(targetOklch, offset);
        const shadeHex = oklchToHex(shade);
        fullColorMap.set(memberHex, shadeHex);
      }
    }

    // Rewrite SVG with the custom color map
    const recoloredSvg = recolorSvg(body.svg, fullColorMap);

    return Response.json({ recoloredSvg });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
