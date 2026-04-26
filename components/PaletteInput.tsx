"use client";

import { useState, useCallback } from "react";

interface PaletteInputProps {
  palette: string[];
  onChange: (palette: string[]) => void;
}

const DEFAULT_PALETTE = ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"];

export default function PaletteInput({ palette, onChange }: PaletteInputProps) {
  const [errors, setErrors] = useState<boolean[]>([false, false, false, false]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      const hex = value.startsWith("#") ? value : `#${value}`;
      const newPalette = [...palette];
      newPalette[index] = hex;
      onChange(newPalette);

      // Validate
      const newErrors = [...errors];
      newErrors[index] = !/^#[0-9a-fA-F]{6}$/.test(hex) && value.length > 0;
      setErrors(newErrors);
    },
    [palette, onChange, errors]
  );

  const isValidPalette = palette.every((hex) => /^#[0-9a-fA-F]{6}$/.test(hex));

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-[var(--muted)] mb-2 uppercase tracking-wider">
        Target Palette
      </label>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {/* Palette preview strip */}
        <div className="flex h-10 rounded-lg overflow-hidden mb-4 shadow-sm">
          {palette.map((hex, i) => (
            <div
              key={i}
              className="flex-1 transition-colors duration-300"
              style={{
                backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hex)
                  ? hex
                  : "#e5e5e5",
              }}
            />
          ))}
        </div>

        {/* Color inputs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {palette.map((hex, i) => (
            <div key={i} className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)]">
                {/* Color swatch */}
                <div
                  className="w-5 h-5 rounded-md border border-[var(--border)] shrink-0"
                  style={{
                    backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hex)
                      ? hex
                      : "transparent",
                  }}
                />
                {/* Input */}
                <input
                  type="text"
                  value={hex}
                  onChange={(e) => handleChange(i, e.target.value)}
                  placeholder="#000000"
                  maxLength={7}
                  className={`
                    w-full text-sm font-mono bg-transparent outline-none
                    placeholder:text-[var(--muted)]
                    ${errors[i] ? "text-[var(--danger)]" : "text-[var(--foreground)]"}
                  `}
                />
              </div>
              {errors[i] && (
                <p className="text-[10px] text-[var(--danger)] mt-1 pl-1">
                  Invalid hex
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Quick palette presets */}
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <p className="text-[10px] uppercase tracking-wider text-[var(--muted)] mb-2">
            Presets
          </p>
          <div className="flex gap-2 flex-wrap">
            {PRESETS.map((preset, i) => (
              <button
                key={i}
                onClick={() => onChange(preset.colors)}
                className="flex h-5 rounded overflow-hidden border border-[var(--border)] hover:border-[var(--border-strong)] hover:scale-105 transition-transform"
                title={preset.name}
              >
                {preset.colors.map((c, j) => (
                  <div
                    key={j}
                    className="w-5 h-full"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const PRESETS = [
  { name: "Ocean", colors: ["#264653", "#2a9d8f", "#e9c46a", "#e76f51"] },
  { name: "Nordic", colors: ["#1d3557", "#457b9d", "#a8dadc", "#f1faee"] },
  { name: "Earth", colors: ["#606c38", "#283618", "#fefae0", "#dda15e"] },
  { name: "Berry", colors: ["#590d22", "#800f2f", "#c9184a", "#ff758f"] },
  { name: "Mono", colors: ["#0d1b2a", "#1b263b", "#415a77", "#778da9"] },
  { name: "Sunset", colors: ["#03071e", "#dc2f02", "#e85d04", "#faa307"] },
];
