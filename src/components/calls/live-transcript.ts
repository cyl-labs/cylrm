/**
 * Listen to a live call and report what each side says.
 *
 * Browser-side, because it has to be: the app dials from a *credential*
 * connection — the only kind a WebRTC softphone can register against — so these
 * legs are not addressable by the Call Control commands that would fork media
 * server-side. `audio-bridge.ts` documents the same wall at more length.
 *
 * Two things about the shape here are load-bearing:
 *
 * **Nothing is sent until `arm()` is called.** Capture starts as soon as the
 * call goes active and fills a ring buffer, but no socket opens and no bytes
 * leave the browser. Voicemail is 28.8% of all calls and a caller knows within
 * two seconds whether they have a machine, which makes them a free and perfect
 * detector — better than any classifier that has to hear the greeting first,
 * pay for it, and then be right.
 *
 * **But the buffer is what makes that safe.** "Not interested" is 24% of
 * outcomes and lands in the first few seconds, often over the opener. A naive
 * press-then-open sequence burns two to four seconds minting a token and
 * negotiating a session, and misses it. So `arm()` flushes the preceding
 * PREROLL_MS first, then continues live.
 *
 * The module is deliberately vendor-shaped only on the inside: `start()` takes
 * streams and returns callbacks. Swapping OpenAI for Deepgram is this file.
 */

const SESSION_URL = "wss://api.openai.com/v1/realtime?intent=transcription";
const WORKLET = "/pcm-worklet.js";

/** How much audio to keep before arming. 8 kHz mu-law is one byte per sample,
 *  so 20 s is 160 KB — nothing, and comfortably longer than an opener. */
const PREROLL_MS = 20_000;
const BYTES_PER_MS = 8;
const PREROLL_BYTES = PREROLL_MS * BYTES_PER_MS;

/** Stop sending after this long. Past it the caller is in a real conversation
 *  and is not reading objection cards. */
export const MAX_STREAM_MS = 6 * 60_000;

export type Utterance = { speaker: "caller" | "prospect"; text: string };

export type LiveTranscript = {
  /** Open the session and flush the pre-roll. Safe to call twice. */
  arm: () => void;
  /** Stop everything and release the microphone. Safe to call twice. */
  stop: () => void;
  armed: () => boolean;
};

type Side = "caller" | "prospect";

/** One side's capture: a worklet writing into a ring buffer, and once armed,
 *  straight out to the socket. */
type Tap = {
  ctx: AudioContext;
  node: AudioWorkletNode;
  src: MediaStreamAudioSourceNode;
  chunks: Uint8Array[];
  bytes: number;
};

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function makeTap(
  stream: MediaStream,
  onFrame: (frame: Uint8Array) => void,
): Promise<Tap> {
  // Native rate, never `{ sampleRate: 8000 }`: Firefox throws when a
  // MediaStreamAudioSourceNode is connected into a differently-rated context.
  // The worklet does the downsampling instead.
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  await ctx.audioWorklet.addModule(WORKLET);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-worklet");
  const tap: Tap = { ctx, node, src, chunks: [], bytes: 0 };
  node.port.onmessage = (e: MessageEvent<Uint8Array>) => onFrame(e.data);
  src.connect(node);
  // Not connected to ctx.destination on purpose: routing call audio back to the
  // speakers would echo the prospect into the caller's ear.
  return tap;
}

function pushRing(tap: Tap, frame: Uint8Array) {
  tap.chunks.push(frame);
  tap.bytes += frame.length;
  while (tap.bytes > PREROLL_BYTES && tap.chunks.length > 1) {
    tap.bytes -= tap.chunks.shift()!.length;
  }
}

/**
 * Begin capturing. Returns immediately; nothing is transmitted until `arm()`.
 *
 * Both sides are captured. Prospect-only was the original design, to halve the
 * cost — measurement killed it: the caller's side correctly silenced eleven
 * false positives across two calls with no incorrect silencing, because the
 * script asks questions whose answers otherwise read as objections. The saving
 * was about $0.25/month.
 */
export async function startLiveTranscript(opts: {
  prospect: MediaStream;
  /** The caller's own microphone. Deliberately a fresh `getUserMedia` rather
   *  than the call's sender track: during a merge that track carries the mixed
   *  bridge output, not the caller alone. Permission is already granted by the
   *  time a call is up, so this prompts for nothing. */
  caller: MediaStream;
  onUtterance: (u: Utterance) => void;
  onEnd?: (reason: string) => void;
}): Promise<LiveTranscript> {
  let socket: WebSocket | null = null;
  let armed = false;
  let closed = false;
  let reconnects = 0;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  const taps: Partial<Record<Side, Tap>> = {};

  const send = (side: Side, frame: Uint8Array) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: b64(frame),
        // Both sides ride one session; the label comes back on the event so
        // speaker separation stays structural rather than diarised.
        ...(side === "caller" ? { role: "caller" } : {}),
      }),
    );
  };

  const onFrame = (side: Side) => (frame: Uint8Array) => {
    const tap = taps[side];
    if (!tap) return;
    if (armed) send(side, frame);
    else pushRing(tap, frame);
  };

  taps.prospect = await makeTap(opts.prospect, onFrame("prospect"));
  try {
    taps.caller = await makeTap(opts.caller, onFrame("caller"));
  } catch {
    // The prospect's side is the one that carries objections. If the caller's
    // own microphone cannot be tapped we lose disambiguation, not the feature.
    taps.caller = undefined;
  }

  const teardown = (reason: string) => {
    if (closed) return;
    closed = true;
    if (deadline) clearTimeout(deadline);
    for (const tap of Object.values(taps)) {
      if (!tap) continue;
      try {
        tap.node.port.onmessage = null;
        tap.src.disconnect();
        tap.node.disconnect();
      } catch {
        // Already detached.
      }
      void tap.ctx.close().catch(() => {});
    }
    for (const t of opts.caller.getTracks()) {
      try {
        t.stop();
      } catch {
        // Already stopped.
      }
    }
    try {
      socket?.close();
    } catch {
      // Already closing.
    }
    socket = null;
    opts.onEnd?.(reason);
  };

  const open = async () => {
    const res = await fetch("/api/openai/token", { method: "POST" });
    if (!res.ok) throw new Error(String(res.status));
    const { token } = (await res.json()) as { token: string };

    // A browser cannot set an Authorization header on a WebSocket, so the
    // credential rides in the subprotocol.
    const ws = new WebSocket(SESSION_URL, [
      "realtime",
      `openai-insecure-api-key.${token}`,
      "openai-beta.realtime-v1",
    ]);
    socket = ws;

    ws.onopen = () => {
      // Flush the pre-roll first, oldest frame first, then go live.
      for (const side of ["caller", "prospect"] as Side[]) {
        const tap = taps[side];
        if (!tap) continue;
        for (const frame of tap.chunks) send(side, frame);
        tap.chunks = [];
        tap.bytes = 0;
      }
    };

    ws.onmessage = (e) => {
      let msg: { type?: string; transcript?: string } | null = null;
      try {
        msg = JSON.parse(e.data as string);
      } catch {
        return;
      }
      if (
        msg?.type === "conversation.item.input_audio_transcription.completed" &&
        typeof msg.transcript === "string" &&
        msg.transcript.trim()
      ) {
        // Only finals. Deltas are noise for a classifier that needs a whole
        // thought, and were measured to be where fragment errors come from.
        opts.onUtterance({ speaker: "prospect", text: msg.transcript.trim() });
      }
    };

    ws.onclose = () => {
      if (closed || !armed) return;
      // One retry, then quiet. A socket dropping twenty seconds in would
      // otherwise kill the feature for the rest of the call with no signal at
      // all; retrying forever would hammer a service that is plainly unwell.
      if (reconnects >= 1) return teardown("socket closed");
      reconnects += 1;
      void open().catch(() => teardown("reconnect failed"));
    };

    ws.onerror = () => {
      // `onclose` always follows; handled there so retries are counted once.
    };
  };

  return {
    armed: () => armed,
    arm: () => {
      if (armed || closed) return;
      armed = true;
      deadline = setTimeout(() => teardown("time limit"), MAX_STREAM_MS);
      void open().catch(() => teardown("could not open a session"));
    },
    stop: () => teardown("stopped"),
  };
}
