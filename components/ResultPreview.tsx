"use client";

import { useMemo } from "react";

interface ResultPreviewProps {
  originalSvg: string;
  recoloredSvg: string;
  alternativeSvg?: string | null;
  activeVariant?: "primary" | "alternative";
  onSelectVariant?: (v: "primary" | "alternative") => void;
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

function SvgPanel({
  svg,
  label,
  aspectRatio,
  isSelected,
  isSelectable,
  onSelect,
  isLoading,
}: {
  svg: string;
  label: string;
  aspectRatio?: number;
  isSelected?: boolean;
  isSelectable?: boolean;
  onSelect?: () => void;
  isLoading?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] uppercase tracking-wider text-[var(--muted)] font-semibold">
          {label}
        </p>
        {isSelectable && (
          <button
            onClick={onSelect}
            className={`
              text-[11px] font-semibold px-3 py-1 rounded-full transition-all duration-200
              ${isSelected
                ? "bg-[#1a1a1a] text-white"
                : "bg-[var(--border)] text-[var(--muted)] hover:bg-[var(--border-strong)] hover:text-[var(--foreground)]"
              }
            `}
          >
            {isSelected ? "✓ Selected" : "Use this"}
          </button>
        )}
      </div>
      <div
        className={`
          flex-1 flex items-center justify-center rounded-2xl bg-white p-6 shadow-sm
          transition-all duration-300
          ${isSelectable
            ? isSelected
              ? "border-2 border-[#1a1a1a]"
              : "border border-[var(--border)] hover:border-[var(--border-strong)] cursor-pointer"
            : "border border-[var(--border)]"
          }
          ${isLoading ? "opacity-50" : "opacity-100"}
        `}
        onClick={isSelectable && !isSelected ? onSelect : undefined}
      >
        <div
          className="w-full max-w-sm"
          style={aspectRatio ? { aspectRatio: `${aspectRatio}` } : undefined}
        >
          <div
            className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ResultPreview({
  originalSvg,
  recoloredSvg,
  alternativeSvg,
  activeVariant = "primary",
  onSelectVariant,
  isLoading,
}: ResultPreviewProps) {
  const aspectRatio = useMemo(() => extractAspectRatio(originalSvg), [originalSvg]);
  const hasAlternative = !!alternativeSvg;

  return (
    <div className="w-full h-full flex flex-col gap-6">
      {/* Loading spinner overlay */}
      {isLoading && (
        <div className="flex items-center justify-center py-2">
          <div className="w-6 h-6 border-2 border-[var(--border)] border-t-[#1a1a1a] rounded-full animate-spin-slow" />
        </div>
      )}

      {hasAlternative ? (
        /* 3-column layout: original | primary | alternative */
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <SvgPanel
            svg={originalSvg}
            label="Original"
            aspectRatio={aspectRatio}
          />
          <SvgPanel
            svg={recoloredSvg}
            label="Option A"
            aspectRatio={aspectRatio}
            isSelectable
            isSelected={activeVariant === "primary"}
            onSelect={() => onSelectVariant?.("primary")}
            isLoading={isLoading}
          />
          <SvgPanel
            svg={alternativeSvg!}
            label="Option B"
            aspectRatio={aspectRatio}
            isSelectable
            isSelected={activeVariant === "alternative"}
            onSelect={() => onSelectVariant?.("alternative")}
            isLoading={isLoading}
          />
        </div>
      ) : (
        /* 2-column layout: original | recolored */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SvgPanel
            svg={originalSvg}
            label="Original"
            aspectRatio={aspectRatio}
          />
          <SvgPanel
            svg={recoloredSvg}
            label="Recolored"
            aspectRatio={aspectRatio}
            isLoading={isLoading}
          />
        </div>
      )}
    </div>
  );
}
