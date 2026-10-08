/**
 * Ask the phone line whether it is still registered, and treat silence as an
 * answer (2026-10-08).
 *
 * The SDK's `getIsRegistered()` sends a message down the websocket and waits
 * for the reply **with no timeout**. On a connection that has died without
 * telling anybody the reply never comes, so the question hung forever, the
 * watchdog that asked it never reached a verdict, and the header went on
 * saying "Phone on". Akshansh was rung by Aaron with the light on: Telnyx
 * waited about 28 seconds and refused the call SIP 480, and it showed up as a
 * missed call with no incoming-call prompt.
 *
 * - `registered` / `down`: the gateway answered.
 * - `silent`: nothing came back inside `waitMs`. A live socket answers in
 *   milliseconds, so this means the connection is not carrying messages.
 * - `unknown`: the question itself threw. Not evidence either way, so the
 *   caller leaves a working line alone.
 */
export type GatewayAnswer = "registered" | "down" | "silent" | "unknown";

export async function askGateway(
  ask: () => Promise<boolean>,
  waitMs: number,
): Promise<GatewayAnswer> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silent = new Promise<GatewayAnswer>((resolve) => {
    timer = setTimeout(() => resolve("silent"), waitMs);
  });
  try {
    return await Promise.race([
      ask().then((ok): GatewayAnswer => (ok ? "registered" : "down")),
      silent,
    ]);
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
