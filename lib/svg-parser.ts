// lib/svg-parser.ts — SVG parsing + color extraction using svgson
// Extracts unique colors with structural metadata from SVG XML

export interface ExtractedColor {
  hex: string;
  elements: string[];
  frequency: number;
  area: number;
  depth: number;
}

export interface ParsedSvg {
  node: unknown;
  colors: ExtractedColor[];
}

// TODO: Implement in Step 3
