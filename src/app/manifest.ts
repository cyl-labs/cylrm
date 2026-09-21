import type { MetadataRoute } from "next";

/**
 * What makes the home-screen icon a real app rather than a bookmark.
 *
 * Load-bearing for **reminders**, not decoration. Safari on iOS exposes no
 * `PushManager` in an ordinary tab, which is why `pushSupport()` returns
 * `ios-needs-install` and the Meetings header tells people to add the CRM to
 * their home screen. But "Add to Home Screen" only produces the standalone web
 * app that gets push when the site *declares itself one* — a manifest saying
 * `display: standalone`, plus the `mobile-web-app-capable` meta that
 * `appleWebApp` in the root layout emits. Without both, the icon opens a
 * browser view, `PushManager` is still missing, and the instruction the app
 * gives is a promise it cannot keep: somebody follows it exactly and no
 * reminder ever arrives.
 *
 * It also fixes the reason the icon was hard to find at all. With no icon
 * declared, iOS makes one from a screenshot of whatever page was open, so the
 * home screen gets a grey thumbnail of the Meetings table rather than a mark
 * anybody would recognise.
 *
 * `start_url` is `/`, which redirects to the call workspace's home — the one
 * place that decides where signing in lands, so this does not become a second
 * answer to that question.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Call CRM",
    // What sits under the icon. Kept to two short words because iOS truncates
    // a home-screen label at about twelve characters.
    short_name: "Call CRM",
    description: "Internal cold outreach console",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f6",
    // The green of the workspace mark rather than the clay primary: this is
    // the Call CRM, and the icon it tints has to match the square in the
    // sidebar people already recognise.
    theme_color: "#00a06a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // Declared maskable as well so Android crops rather than letterboxing
      // it. The mark is drawn well inside the safe area for that reason.
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
