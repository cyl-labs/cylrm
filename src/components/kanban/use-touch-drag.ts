"use client";

import * as React from "react";

/** How long a finger must rest on a card before it is picked up. Long enough
 *  that a flick to scroll never lifts a card, short enough not to feel stuck. */
const HOLD_MS = 240;
/** Movement that cancels the hold: past this the gesture is a scroll. */
const SLOP_PX = 12;
/** Distance from an edge at which the board starts scrolling itself. */
const EDGE_PX = 72;
const EDGE_SPEED = 14;

type Point = { x: number; y: number };

/**
 * Drag and drop for touch.
 *
 * HTML5 drag events never fire on a touchscreen, so the boards had a menu on
 * every card as the only route — correct, but not what anyone expects to do
 * with a kanban on a phone. This adds the gesture: hold a card, drag it, drop
 * it on a column.
 *
 * Long-press to pick up rather than drag-on-contact, because on a phone the
 * board is a horizontal scroller and each column scrolls vertically — a card
 * that moved the moment a finger touched it would make the board unscrollable.
 * While a card is held the page is stopped from scrolling under it, and the
 * board scrolls itself when the finger nears an edge, which is the only way to
 * reach a column that is off-screen.
 */
export function useTouchDrag({
  onDrop,
  canDrop = () => true,
  scrollerRef,
}: {
  /** Called with the dragged card's id and the column it was dropped on. */
  onDrop: (id: number, column: string) => void;
  /** Columns that refuse drops — "To call" cannot be reached by phone call. */
  canDrop?: (column: string) => boolean;
  /** The horizontally scrolling board, so a drag can pan it. */
  scrollerRef: React.RefObject<HTMLElement | null>;
}) {
  // The callers pass inline arrows, so these are held in a ref and every
  // callback below is stable. They were dependencies once: `end` changed
  // identity on every render, the unmount cleanup that calls it therefore ran
  // on every render, and it cancelled the hold timer before it could fire —
  // the gesture never started.
  const cb = React.useRef({ onDrop, canDrop });
  cb.current = { onDrop, canDrop };

  const [dragId, setDragId] = React.useState<number | null>(null);
  const [pointer, setPointer] = React.useState<Point | null>(null);
  const [over, setOver] = React.useState<string | null>(null);

  // Everything the gesture needs between events, kept in a ref so the window
  // listeners never close over stale state.
  const g = React.useRef<{
    id: number | null;
    start: Point;
    /** Where the finger is now, read by the auto-scroll loop each frame. */
    last: Point;
    holdTimer: number | null;
    dragging: boolean;
    frame: number | null;
    snap: string;
  }>({
    id: null,
    start: { x: 0, y: 0 },
    last: { x: 0, y: 0 },
    holdTimer: null,
    dragging: false,
    frame: null,
    snap: "",
  });

  const columnAt = (p: Point) => {
    const el = document.elementFromPoint(p.x, p.y);
    return el?.closest<HTMLElement>("[data-column]")?.dataset.column ?? null;
  };

  const stopScroll = React.useCallback((e: TouchEvent) => e.preventDefault(), []);

  const end = React.useCallback(
    (drop: boolean) => {
      const state = g.current;
      if (state.holdTimer) clearTimeout(state.holdTimer);
      if (state.frame) cancelAnimationFrame(state.frame);
      document.removeEventListener("touchmove", stopScroll);

      const scroller = scrollerRef.current;
      if (scroller) scroller.style.scrollSnapType = state.snap;

      if (drop && state.dragging && state.id !== null) {
        setOver((column) => {
          if (column && cb.current.canDrop(column)) {
            cb.current.onDrop(state.id!, column);
          }
          return null;
        });
      } else {
        setOver(null);
      }

      g.current = {
        id: null,
        start: { x: 0, y: 0 },
        last: { x: 0, y: 0 },
        holdTimer: null,
        dragging: false,
        frame: null,
        snap: "",
      };
      setDragId(null);
      setPointer(null);
    },
    [scrollerRef, stopScroll],
  );

  /** Pan the board, and the column under the finger, when the drag nears an
   *  edge. Without this only the column already on screen is reachable.
   *
   *  Runs every frame for as long as the card is held, not once per move: a
   *  finger parked against the edge stops producing pointermove events, and
   *  panning that only advanced while the finger wandered was unusable on a
   *  phone, where the target column is always off-screen. */
  const autoScroll = React.useCallback(
    (p: Point) => {
      const scroller = scrollerRef.current;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (p.x < r.left + EDGE_PX) scroller.scrollLeft -= EDGE_SPEED;
        else if (p.x > r.right - EDGE_PX) scroller.scrollLeft += EDGE_SPEED;
      }
      const column = document
        .elementFromPoint(p.x, p.y)
        ?.closest<HTMLElement>("[data-column]")
        ?.querySelector<HTMLElement>("[data-column-scroll]");
      if (column) {
        const r = column.getBoundingClientRect();
        if (p.y < r.top + EDGE_PX) column.scrollTop -= EDGE_SPEED;
        else if (p.y > r.bottom - EDGE_PX) column.scrollTop += EDGE_SPEED;
      }
    },
    [scrollerRef],
  );

  const onPointerDown = (id: number) => (e: React.PointerEvent) => {
    // Mouse keeps the native HTML5 drag it already had; this is for fingers.
    if (e.pointerType === "mouse") return;
    const start = { x: e.clientX, y: e.clientY };
    g.current.id = id;
    g.current.start = start;
    g.current.last = start;
    g.current.holdTimer = window.setTimeout(() => {
      g.current.dragging = true;
      setDragId(id);
      setPointer(start);
      setOver(columnAt(start));
      // Stop the page scrolling under the held card. A non-passive listener is
      // the only way; `touch-action: none` on the card would have to be set
      // before the touch began, which would kill scrolling from a card.
      document.addEventListener("touchmove", stopScroll, { passive: false });
      const scroller = scrollerRef.current;
      if (scroller) {
        // Mandatory snap fights a drag-pan, so it is off for the duration.
        g.current.snap = scroller.style.scrollSnapType;
        scroller.style.scrollSnapType = "none";
      }
      navigator.vibrate?.(12);

      const step = () => {
        if (!g.current.dragging) return;
        autoScroll(g.current.last);
        setOver(columnAt(g.current.last));
        g.current.frame = requestAnimationFrame(step);
      };
      g.current.frame = requestAnimationFrame(step);
    }, HOLD_MS);
  };

  React.useEffect(() => {
    function move(e: PointerEvent) {
      const state = g.current;
      if (state.id === null) return;
      const p = { x: e.clientX, y: e.clientY };
      if (!state.dragging) {
        const far =
          Math.abs(p.x - state.start.x) > SLOP_PX ||
          Math.abs(p.y - state.start.y) > SLOP_PX;
        // Moved before the hold completed — they are scrolling, not dragging.
        if (far && state.holdTimer) {
          clearTimeout(state.holdTimer);
          state.holdTimer = null;
          state.id = null;
        }
        return;
      }
      state.last = p;
      setPointer(p);
    }
    function up() {
      if (g.current.id !== null) end(true);
    }
    function cancel() {
      if (g.current.id !== null) end(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [autoScroll, end]);

  // Unmount only — `end` is stable, but spelling the dependency out here
  // would re-arm this on every render if it ever stopped being.
  const endRef = React.useRef(end);
  endRef.current = end;
  React.useEffect(() => () => endRef.current(false), []);

  return {
    /** The card being held, or null. */
    dragId,
    /** Column under the finger, for highlighting. */
    over,
    /** Where to draw the card that follows the finger. */
    pointer,
    /** Spread onto a card: `{...touchDrag.cardProps(id)}`. */
    cardProps: (id: number) => ({ onPointerDown: onPointerDown(id) }),
  };
}
