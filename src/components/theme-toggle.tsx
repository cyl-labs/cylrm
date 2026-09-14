"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

/**
 * Switch between light and dark, for this browser.
 *
 * Both labels are rendered and CSS shows the right one, so the server's HTML
 * and the first render in the browser are identical whatever this browser has
 * saved. Reading the theme during render would be a hydration mismatch: the
 * server cannot know what was saved.
 *
 * Labelled with what it switches *to*, like a light switch that says "off".
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="flex h-[38px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Moon className="size-[17px] dark:hidden" strokeWidth={1.8} />
      <Sun className="hidden size-[17px] dark:block" strokeWidth={1.8} />
      <span className="dark:hidden">Dark mode</span>
      <span className="hidden dark:inline">Light mode</span>
    </button>
  );
}
