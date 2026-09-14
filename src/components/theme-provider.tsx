"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Light or dark, remembered per browser.
 *
 * Mounted in the app layout rather than the root one, on purpose: the login
 * page and the public unsubscribe page stay light whatever a signed-in browser
 * last chose. The unsubscribe page is read by the people we email, and has no
 * business turning dark because a founder once opened a link on their laptop.
 *
 * `next-themes` sets the class on <html> from a small script before the page
 * paints, so there is no flash of the wrong theme — which is also why the root
 * layout's <html> carries `suppressHydrationWarning`.
 *
 * **The options live in here, not in a constant the layout imports.** The app
 * layout is a server component, and a plain value exported from a "use client"
 * module reaches a server component as a reference rather than the value. The
 * first version spread such a constant into the provider: every option came
 * through empty, the library fell back to its defaults — a `data-theme`
 * attribute the `dark:` classes never read, under a different storage key — and
 * the toggle appeared to do nothing.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      // Light stays the default: nobody who never touches the toggle should
      // find the app looking different tomorrow.
      defaultTheme="light"
      enableSystem={false}
      storageKey="cylrm-theme"
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
