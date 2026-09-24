"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Something is loading — for a change *within* a screen (2026-09-24).
 *
 * `loading.tsx` covers arriving at a slow screen. It cannot cover a filter:
 * Next keeps the page up while the same screen reloads with a new range, a new
 * month or a new zone, so Stats' date range sat for two seconds on the old
 * numbers with nothing to say a click had landed. "I'm fine with waiting a bit
 * but I need to know what's happening."
 *
 * - **Started by any link that changes the page**, caught in one place — a click
 *   on an `<a>` to another address on this site — so no screen's links need to
 *   know about it. Pickers and selects that change the address in code call
 *   `beginNavigation` first.
 * - **Finished when the address changes**, which is the moment the new page is
 *   in place — or the moment a loading screen took over, which says the rest.
 * - **Quiet when it is quick**: the bar after 150ms, the "Loading…" label and
 *   the dimmed page after 400ms. A background refresh never starts it at all.
 * - Gives up after twenty seconds, so a navigation that went nowhere cannot
 *   leave it spinning.
 */

const NAV_EVENT = "cylrm-navigating";
const GIVE_UP_MS = 20_000;

/** Say a navigation is starting. For code that changes the address itself —
 *  `router.replace` from a picker — since only link clicks are seen here. */
export function beginNavigation(href?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NAV_EVENT, { detail: href ?? null }));
}

/** Where this click would go is where we already are: nothing to wait for. */
function isHere(href: string): boolean {
  try {
    const url = new URL(href, window.location.href);
    return (
      url.origin === window.location.origin &&
      url.pathname === window.location.pathname &&
      url.search === window.location.search
    );
  } catch {
    return true;
  }
}

export function NavigationProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const [pending, setPending] = React.useState(false);

  // The address changed, so whatever was loading has arrived. Adjusted during
  // render rather than in an effect, React's way of following a value.
  const here = `${pathname}?${search}`;
  const [seen, setSeen] = React.useState(here);
  if (here !== seen) {
    setSeen(here);
    if (pending) setPending(false);
  }

  React.useEffect(() => {
    const start = (href: string | null) => {
      if (href && isHere(href)) return;
      setPending(true);
    };
    const onNav = (e: Event) => start((e as CustomEvent<string | null>).detail);
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      // A new tab, a download, another site, a file from the API: none of those
      // leave this page loading anything.
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/")) return;
      start(a.href);
    };
    const onPop = () => setPending(false);
    window.addEventListener(NAV_EVENT, onNav);
    // Capture, so a link whose own handler stops the click still counts.
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener(NAV_EVENT, onNav);
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  React.useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [pending]);

  // The dimmed page, through one attribute on the document, so no screen has
  // to know this exists: `globals.css` fades `[data-page-body]` while it is set.
  //
  // A layout effect, so the attribute is gone before the browser paints the
  // page that has just arrived. With a plain effect the new page was drawn
  // once under it — dimmed at once, since an element mounts at the rule's
  // value with no transition — and then faded up: a flash on every quick load.
  React.useLayoutEffect(() => {
    const root = document.documentElement;
    if (pending) root.setAttribute("data-navigating", "");
    else root.removeAttribute("data-navigating");
    return () => root.removeAttribute("data-navigating");
  }, [pending]);

  if (!pending) return null;
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] overflow-hidden opacity-0 animate-[nav-fade-in_200ms_ease-out_150ms_forwards]"
      >
        <div className="h-full w-2/5 bg-primary animate-[nav-progress_1.1s_ease-in-out_infinite]" />
      </div>
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-24 z-[60] flex justify-center px-4 opacity-0 animate-[nav-fade-in_200ms_ease-out_400ms_forwards]"
      >
        {/* Solid, not a tint: it floats over whatever screen is open. */}
        <p className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-[13px] font-semibold shadow-lg">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          Loading…
        </p>
      </div>
    </>
  );
}
