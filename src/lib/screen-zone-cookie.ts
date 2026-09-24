/** Shared by the server read and the picker's write, so the two cannot name
 *  the cookie differently. No server imports: the picker is a client module. */
export type ZoneScreen = "scoreboard" | "call-stats" | "meetings";

export const SCREEN_ZONE_COOKIE = (screen: ZoneScreen) => `cylrm-tz-${screen}`;
