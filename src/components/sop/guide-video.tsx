"use client";

import * as React from "react";

/** Where in the video this browser got to, per guide. Per browser rather than
 *  per account, like the theme: it is a fact about this screen on this
 *  machine, and it is not worth a column or a round trip. */
const key = (slug: string) => `cylrm-guide-at:${slug}`;

/** Under this and there is nothing to resume — somebody pressed play and
 *  changed their mind. Within this of the end and it is finished, so it starts
 *  over rather than reopening on the credits. */
const FLOOR_SECONDS = 15;
const END_SECONDS = 20;

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The video guide, which remembers where you stopped.
 *
 * A caller watches this between calls, and the phone rings six minutes into a
 * six-minute video. Without this they scrub back to roughly where they were,
 * which nobody does twice — they stop watching instead.
 *
 * Saved on pause, on hiding the tab and every few seconds while it plays. All
 * three, because none of them fires reliably on its own: closing a tab does
 * not always pause, `beforeunload` is skipped when a phone backgrounds the
 * browser, and `visibilitychange` is the one that survives being interrupted
 * by a call.
 */
export function GuideVideo({ slug }: { slug: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  // Only set when a position was actually restored, so the line under the
  // video is never shown to somebody starting from the beginning.
  const [resumedAt, setResumedAt] = React.useState<number | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const save = () => {
      try {
        const at = el.currentTime;
        const end = el.duration;
        // Finished, or as near as makes no difference: forget it, so the next
        // visit opens at the start rather than on the last frame.
        if (at < FLOOR_SECONDS || (end && at > end - END_SECONDS)) {
          localStorage.removeItem(key(slug));
        } else {
          localStorage.setItem(key(slug), String(Math.floor(at)));
        }
      } catch {
        // Private window or blocked site data. Losing the position is the
        // whole cost, and there is nothing useful to say about it.
      }
    };

    // `loadedmetadata`, not mount: seeking before the duration is known is
    // silently ignored, and with `preload="metadata"` that is most of the
    // time this component is on screen.
    const restore = () => {
      try {
        const saved = Number(localStorage.getItem(key(slug)));
        if (!saved || !Number.isFinite(saved)) return;
        if (el.duration && saved > el.duration - END_SECONDS) return;
        el.currentTime = saved;
        setResumedAt(saved);
      } catch {
        /* see above */
      }
    };

    // Every few seconds rather than on every tick: `timeupdate` fires about
    // four times a second, and this is a synchronous write to disk.
    let last = 0;
    const onTime = () => {
      if (Date.now() - last < 5000) return;
      last = Date.now();
      save();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") save();
    };

    el.addEventListener("loadedmetadata", restore);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", save);
    el.addEventListener("ended", save);
    document.addEventListener("visibilitychange", onHide);
    if (el.readyState >= 1) restore();

    return () => {
      save();
      el.removeEventListener("loadedmetadata", restore);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", save);
      el.removeEventListener("ended", save);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [slug]);

  return (
    <div className="mt-4">
      {/* `preload="metadata"`: the file is tens of megabytes and this page is
          opened to read the script far more often than to watch anything, so
          nothing is fetched until somebody presses play. It also has to be at
          least this much, or there is no duration to seek within. */}
      <video
        ref={ref}
        className="w-full rounded-xl border bg-black"
        controls
        preload="metadata"
        playsInline
        src={`/api/guides/${slug}`}
      />
      {resumedAt !== null && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          Picking up where you stopped, at {mmss(resumedAt)}.
          <button
            type="button"
            className="font-bold text-primary hover:underline"
            onClick={() => {
              const el = ref.current;
              if (!el) return;
              el.currentTime = 0;
              setResumedAt(null);
              try {
                localStorage.removeItem(key(slug));
              } catch {
                /* nothing to say */
              }
            }}
          >
            Start from the beginning
          </button>
        </p>
      )}
    </div>
  );
}
