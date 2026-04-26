// app/api/preview/route.ts — SVG preview endpoint
// Parses an SVG and returns extracted color info for the UI

import { parseSvg } from "@/lib/svg-parser";
import { clusterColors } from "@/lib/color-assignment";

export interface PreviewRequest {
  svg: string;
}

export interface PreviewResponse {
  /** All unique colors found */
  colors: {
    hex: string;
    elements: string[];
    frequency: number;
    area: number;
  }[];
  /** Color families from clustering */
  families: {
    baseHex: string;
    memberHexes: string[];
    memberCount: number;
  }[];
  /** Total unique color count */
  colorCount: number;
  /** Total family count */
  familyCount: number;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PreviewRequest;

    if (!body.svg || typeof body.svg !== "string") {
      return Response.json(
        { error: "Missing or invalid 'svg' field" },
        { status: 400 }
      );
    }

    const { colors } = parseSvg(body.svg);
    const { families } = clusterColors(colors);

    const response: PreviewResponse = {
      colors: colors.map((c) => ({
        hex: c.hex,
        elements: c.elements,
        frequency: c.frequency,
        area: c.area,
      })),
      families: families.map((f) => ({
        baseHex: f.base.hex,
        memberHexes: f.members.map((m) => m.hex),
        memberCount: f.members.length,
      })),
      colorCount: colors.length,
      familyCount: families.length,
    };

    return Response.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
