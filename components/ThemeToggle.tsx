"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check localStorage first, default to light
    const stored = localStorage.getItem("hueswap-theme") as Theme | null;
    if (stored) {
      setTheme(stored);
      document.documentElement.classList.toggle("dark", stored === "dark");
    } else {
      // Default to light mode regardless of system preference
      setTheme("light");
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("hueswap-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  // Avoid hydration mismatch — render nothing until mounted
  if (!mounted) {
    return <div className="h-7 w-[88px]" />;
  }

  const isDark = theme === "dark";

  return (
    <div className="flex items-center gap-2">
      {/* Label */}
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {isDark ? "Dark" : "Light"}
      </span>

      {/* Toggle */}
      <button
        onClick={toggle}
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        title={`Switch to ${isDark ? "light" : "dark"} mode`}
        className="
          relative w-14 h-7 rounded-full p-0.5
          bg-[var(--border)] hover:bg-[var(--border-strong)]
          transition-colors duration-300 ease-out
          focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]
          group
        "
      >
        {/* Track background glow */}
        <div
          className={`
            absolute inset-0 rounded-full opacity-0 group-hover:opacity-100
            transition-opacity duration-300
            ${isDark ? "bg-indigo-500/10" : "bg-amber-400/10"}
          `}
        />

        {/* Sliding knob */}
        <div
          className={`
            relative w-6 h-6 rounded-full
            bg-[var(--surface)] shadow-sm
            flex items-center justify-center
            transition-all duration-500 ease-[cubic-bezier(0.68,-0.2,0.27,1.3)]
            ${isDark ? "translate-x-7" : "translate-x-0"}
          `}
        >
          {/* Sun icon */}
          <svg
            className={`
              absolute w-3.5 h-3.5 text-amber-500
              transition-all duration-300
              ${isDark ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100"}
            `}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
          </svg>

          {/* Moon icon */}
          <svg
            className={`
              absolute w-3.5 h-3.5 text-indigo-400
              transition-all duration-300
              ${isDark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50"}
            `}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
          </svg>
        </div>
      </button>
    </div>
  );
}
