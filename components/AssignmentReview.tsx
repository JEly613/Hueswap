"use client";

import { useState, useCallback } from "react";

interface FamilyMapping {
  baseHex: string;
  memberHexes: string[];
  targetHex: string;
}

interface AssignmentReviewProps {
  families: FamilyMapping[];
  targetPalette: string[];
  onConfirm: (updatedMappings: FamilyMapping[]) => void;
  onReset: () => void;
}

export default function AssignmentReview({
  families,
  targetPalette,
  onConfirm,
  onReset,
}: AssignmentReviewProps) {
  const [mappings, setMappings] = useState<FamilyMapping[]>(families);
  const [dragSource, setDragSource] = useState<number | null>(null);

  const handleTargetChange = useCallback(
    (familyIndex: number, newTargetHex: string) => {
      setMappings((prev) => {
        const updated = [...prev];
        updated[familyIndex] = { ...updated[familyIndex], targetHex: newTargetHex };
        return updated;
      });
    },
    []
  );

  const handleDragStart = (index: number) => {
    setDragSource(index);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (targetIndex: number) => {
    if (dragSource === null || dragSource === targetIndex) return;

    setMappings((prev) => {
      const updated = [...prev];
      // Swap target assignments
      const srcTarget = updated[dragSource].targetHex;
      const dstTarget = updated[targetIndex].targetHex;
      updated[dragSource] = { ...updated[dragSource], targetHex: dstTarget };
      updated[targetIndex] = { ...updated[targetIndex], targetHex: srcTarget };
      return updated;
    });
    setDragSource(null);
  };

  const hasMoreFamiliesThanColors = families.length > targetPalette.length;

  if (families.length === 0) return null;

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-[var(--muted)] mb-2 uppercase tracking-wider">
        Color Mapping
      </label>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {/* Warning banner */}
        {hasMoreFamiliesThanColors && (
          <div className="mb-4 px-3 py-2.5 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/20">
            <p className="text-xs font-medium text-[var(--danger)]">
              ⚠ Your design has {families.length} color families but only{" "}
              {targetPalette.length} palette colors. Some families will share a
              target color.
            </p>
          </div>
        )}

        {/* Mapping rows */}
        <div className="space-y-2">
          {mappings.map((mapping, index) => (
            <div
              key={index}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={handleDragOver}
              onDrop={() => handleDrop(index)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg
                border border-transparent
                hover:bg-[var(--surface-hover)] hover:border-[var(--border)]
                cursor-grab active:cursor-grabbing
                transition-all duration-150
                ${dragSource === index ? "opacity-50 scale-95" : ""}
              `}
            >
              {/* Source family swatches */}
              <div className="flex items-center gap-1 min-w-[80px]">
                <div
                  className="w-7 h-7 rounded-md border border-[var(--border)] shadow-sm"
                  style={{ backgroundColor: mapping.baseHex }}
                  title={mapping.baseHex}
                />
                {mapping.memberHexes
                  .filter((h) => h !== mapping.baseHex)
                  .slice(0, 3)
                  .map((hex) => (
                    <div
                      key={hex}
                      className="w-4 h-4 rounded border border-[var(--border)]"
                      style={{ backgroundColor: hex }}
                      title={hex}
                    />
                  ))}
                {mapping.memberHexes.length > 4 && (
                  <span className="text-[10px] text-[var(--muted)] ml-0.5">
                    +{mapping.memberHexes.length - 4}
                  </span>
                )}
              </div>

              {/* Arrow */}
              <svg
                className="w-4 h-4 text-[var(--muted)] shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>

              {/* Target color selector */}
              <div className="flex items-center gap-1.5">
                {targetPalette.map((targetHex) => (
                  <button
                    key={targetHex}
                    onClick={() => handleTargetChange(index, targetHex)}
                    className={`
                      w-7 h-7 rounded-md border-2 transition-all duration-150
                      ${
                        mapping.targetHex === targetHex
                          ? "border-[var(--foreground)] scale-110 shadow-md"
                          : "border-transparent hover:border-[var(--border-strong)] hover:scale-105"
                      }
                    `}
                    style={{ backgroundColor: targetHex }}
                    title={targetHex}
                  />
                ))}
              </div>

              {/* Hex label */}
              <span className="text-[10px] font-mono text-[var(--muted)] ml-auto hidden sm:block">
                {mapping.baseHex} → {mapping.targetHex}
              </span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-[var(--border)]">
          <button
            onClick={onReset}
            className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] px-3 py-1.5 rounded-md hover:bg-[var(--surface-hover)]"
          >
            Reset to suggested
          </button>
          <button
            onClick={() => onConfirm(mappings)}
            className="text-sm font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] px-4 py-2 rounded-lg shadow-sm"
          >
            Apply mapping
          </button>
        </div>
      </div>
    </div>
  );
}
