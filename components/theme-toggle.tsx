"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("offgrid-theme");
    const initial = saved === "light" || saved === "dark" ? saved : systemTheme();
    applyTheme(initial);
    setTheme(initial);

    const preference = window.matchMedia("(prefers-color-scheme: light)");
    const followSystem = () => {
      if (window.localStorage.getItem("offgrid-theme")) return;
      const next = systemTheme();
      applyTheme(next);
      setTheme(next);
    };
    preference.addEventListener("change", followSystem);
    return () => preference.removeEventListener("change", followSystem);
  }, []);

  function toggleTheme() {
    const next: Theme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.classList.add("theme-transitioning");
    applyTheme(next);
    window.localStorage.setItem("offgrid-theme", next);
    setTheme(next);
    window.setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 420);
  }

  const nextTheme = theme === "light" ? "dark" : "light";
  return <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${nextTheme} mode`} title={`Switch to ${nextTheme} mode`}>
    <span className="theme-toggle-icon" aria-hidden="true"><Sun className="theme-sun" size={14}/><Moon className="theme-moon" size={14}/><i /></span>
  </button>;
}
