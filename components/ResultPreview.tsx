"use client";

import { useMemo } from "react";

interface ResultPreviewProps {
  originalSvg: string;
  recoloredSvg: string;
  isLoading?: boolean;
}

function extractAspectRatio(svg: string): number | undefined {
  const vbMatch = svg.match(/viewBox=["']([^"']+)["']/);
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/);
    if (parts.length === 4) {
      const w = parseFloat(parts[2]);
      const h = parseFloat(parts[3]);
      if (w > 0 && h > 0) return w / h;
    }
  }
  const wMatch = svg.match(/\bwidth=["'](\d+(?:\.\d+)?)(?:px)?["']/);
  const hMatch = svg.match(/\bheight=["'](\d+(?:\.\d+)?)(?:px)?["']/);
  if (wMatch && hMatch) {
    const w = parseFloat(wMatch[1]);
    const h = parseFloat(hMatch[1]);
    if (w > 0 && h > 0) return w / h;
  }
  return undefined;
}

export default function ResultPreview({
  originalSvg,
  recoloredSvg,
  isLoading,
}: ResultPreviewProps) {
  const aspectRatio = useMemo(() => extractAspectRatio(originalSvg), [originalSvg]);

  return (
    <div className="w-full h-full flex flex-col">
      {/* Side-by-side comparison */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Original */}
        <div className="flex flex-col">
          <p className="text-[11px] uppercase tracking-wider text-[var(--muted)] mb-3 font-semibold">
            Original
          </p>
          <div className="flex-1 flex items-center justify-center rounded-2xl bg-white border border-[var(--border)] p-6 shadow-sm">
            <div
              className="w-full max-w-sm"
              style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
            >
              <div
                className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                dangerouslySetInnerHTML={{ __html: originalSvg }}
              />
            </div>
          </div>
        </div>

        {/* Recolored */}
        <div className="flex flex-col relative">
          <p className="text-[11px] uppercase tracking-wider text-[var(--muted)] mb-3 font-semibold">
            Recolored
          </p>
          <div className={`
            flex-1 flex items-center justify-center rounded-2xl bg-white border border-[var(--border)] p-6 shadow-sm
            transition-opacity duration-300
            ${isLoading ? "opacity-50" : "opacity-100"}
          `}>
            <div
              className="w-full max-w-sm"
              style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
            >
              <div
                className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                dangerouslySetInnerHTML={{ __html: recoloredSvg }}
              />
            </div>
          </div>

          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center mt-6">
              <div className="w-8 h-8 border-2 border-[var(--border)] border-t-[#1a1a1a] rounded-full animate-spin-slow" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
