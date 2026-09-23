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
      title="Dark or light mode"
      className="flex h-[38px] w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsed=true]/sidebar:justify-center"
    >
      <Moon className="size-[17px] shrink-0 dark:hidden" strokeWidth={1.8} />
      <Sun className="hidden size-[17px] shrink-0 dark:block" strokeWidth={1.8} />
      {/* Words hidden when the desktop sidebar is folded to its icons. */}
      <span className="group-data-[collapsed=true]/sidebar:hidden">
        <span className="dark:hidden">Dark mode</span>
        <span className="hidden dark:inline">Light mode</span>
      </span>
    </button>
  );
}
