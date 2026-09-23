/** Read by the app layout on the server, so the first paint is already the
 *  width this browser chose — localStorage would flash the wide one first.
 *  Here rather than in `components/sidebar.tsx`: a constant exported from a
 *  "use client" module reaches a server component as a reference, not the
 *  string. */
export const SIDEBAR_COOKIE = "cylrm-sidebar";
