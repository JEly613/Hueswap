"use client";

import { useState, useCallback } from "react";

interface PaletteInputProps {
  palette: string[];
  onChange: (palette: string[]) => void;
  mode?: "compact" | "full";
}

const PRESETS = [
  { name: "Sage", colors: ["#86a789", "#b2c8ba", "#d2e3c8", "#ebf3e8"] },
  { name: "Sorbet", colors: ["#fcf9ea", "#badfdb", "#ffa4a4", "#ffbdbd"] },
  { name: "Pastel", colors: ["#ffd5e5", "#ffffdd", "#a0ffe6", "#81f5ff"] },
  { name: "Retro", colors: ["#ebebeb", "#f5a25d", "#fa7f72", "#389393"] },
  { name: "Mauve", colors: ["#999b84", "#926e6f", "#ca8a8b", "#e6c4c0"] },
  { name: "Latte", colors: ["#8d7b68", "#a4907c", "#c8b6a6", "#f1dec9"] },
  { name: "Cosmic", colors: ["#332941", "#3b3486", "#864af9", "#f8e559"] },
  { name: "Blaze", colors: ["#fffae6", "#ff9f66", "#ff5f00", "#002379"] },
  { name: "Ember", colors: ["#ffeee7", "#fbb448", "#e3670c", "#cc3d0b"] },
  { name: "Jungle", colors: ["#fff5f2", "#f5babb", "#568f87", "#064232"] },
  { name: "Signal", colors: ["#e62727", "#f3f2ec", "#dcdcdc", "#1e93ab"] },
  { name: "Olive", colors: ["#627254", "#76885b", "#dddddd", "#eeeeee"] },
];

export default function PaletteInput({ palette, onChange, mode = "compact" }: PaletteInputProps) {
  const [errors, setErrors] = useState<boolean[]>([false, false, false, false]);

  const handleChange = useCallback(
    (index: number, value: string) => {
      const hex = value.startsWith("#") ? value : `#${value}`;
      const newPalette = [...palette];
      newPalette[index] = hex;
      onChange(newPalette);

      const newErrors = [...errors];
      newErrors[index] = !/^#[0-9a-fA-F]{6}$/.test(hex) && value.length > 0;
      setErrors(newErrors);
    },
    [palette, onChange, errors]
  );

  const isActivePalette = (preset: string[]) =>
    preset.every((c, i) => c.toLowerCase() === palette[i]?.toLowerCase());

  if (mode === "compact") {
    return (
      <div className="w-full">
        {/* Compact palette strip with inputs */}
        <div className="rounded-2xl bg-white border border-[var(--border)] shadow-sm p-4">
          {/* Preview strip */}
          <div className="flex h-8 rounded-lg overflow-hidden mb-3">
            {palette.map((hex, i) => (
              <div
                key={i}
                className="flex-1 transition-colors duration-300"
                style={{
                  backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#e5e5e5",
                }}
              />
            ))}
          </div>

          {/* Color inputs */}
          <div className="grid grid-cols-4 gap-2">
            {palette.map((hex, i) => (
              <div key={i} className="relative">
                <input
                  type="text"
                  value={hex}
                  onChange={(e) => handleChange(i, e.target.value)}
                  placeholder="#000000"
                  maxLength={7}
                  className={`
                    w-full text-xs font-mono bg-[var(--background)] rounded-lg px-2 py-1.5
                    border border-[var(--border)] outline-none
                    focus:border-[#1a1a1a] focus:ring-1 focus:ring-[#1a1a1a]/10
                    placeholder:text-[var(--muted)]
                    ${errors[i] ? "text-[var(--danger)] border-[var(--danger)]" : "text-[var(--foreground)]"}
                  `}
                />
              </div>
            ))}
          </div>

          {/* Quick presets row */}
          <div className="mt-3 pt-3 border-t border-[var(--border)]">
            <div className="flex gap-2 flex-wrap">
              {PRESETS.slice(0, 6).map((preset, i) => (
                <button
                  key={i}
                  onClick={() => onChange(preset.colors)}
                  className={`
                    flex h-5 rounded-md overflow-hidden border transition-all
                    ${isActivePalette(preset.colors)
                      ? "border-[#1a1a1a] scale-110 shadow-sm"
                      : "border-[var(--border)] hover:border-[var(--border-strong)] hover:scale-105"
                    }
                  `}
                  title={preset.name}
                >
                  {preset.colors.map((c, j) => (
                    <div key={j} className="w-5 h-full" style={{ backgroundColor: c }} />
                  ))}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full mode — sidebar palette selector
  return (
    <div className="w-full">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-4">
        Palette
      </h3>

      {/* Current palette preview */}
      <div className="flex h-10 rounded-xl overflow-hidden mb-4 shadow-sm border border-[var(--border)]">
        {palette.map((hex, i) => (
          <div
            key={i}
            className="flex-1 transition-colors duration-300"
            style={{
              backgroundColor: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#e5e5e5",
            }}
          />
        ))}
      </div>

      {/* Custom color inputs */}
      <div className="grid grid-cols-2 gap-2 mb-6">
        {palette.map((hex, i) => (
          <div key={i} className="relative">
            <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-2 focus-within:border-[#1a1a1a] focus-within:ring-1 focus-within:ring-[#1a1a1a]/10">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"}
                onChange={(e) => handleChange(i, e.target.value)}
                className="w-5 h-5 rounded border-0 cursor-pointer p-0 bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-[var(--border)]"
              />
              <input
                type="text"
                value={hex}
                onChange={(e) => handleChange(i, e.target.value)}
                placeholder="#000000"
                maxLength={7}
                className={`
                  w-full text-xs font-mono bg-transparent outline-none
                  placeholder:text-[var(--muted)]
                  ${errors[i] ? "text-[var(--danger)]" : "text-[var(--foreground)]"}
                `}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Preset palettes */}
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-3">
        Presets
      </h4>
      <div className="space-y-2">
        {PRESETS.map((preset, i) => (
          <button
            key={i}
            onClick={() => onChange(preset.colors)}
            className={`
              w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200
              ${isActivePalette(preset.colors)
                ? "bg-[#1a1a1a]/5 border border-[#1a1a1a]/20 shadow-sm"
                : "hover:bg-[var(--surface-hover)] border border-transparent"
              }
            `}
          >
            <div className="flex h-6 rounded-md overflow-hidden flex-1 shadow-sm">
              {preset.colors.map((c, j) => (
                <div key={j} className="flex-1 h-full" style={{ backgroundColor: c }} />
              ))}
            </div>
            <span className="text-[11px] font-medium text-[var(--muted)] w-14 text-right">
              {preset.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
