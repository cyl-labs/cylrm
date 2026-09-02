/**
 * Keep the last few seconds of a live call, ready to be asked about.
 *
 * Replaces a continuous transcription session. That one opened a WebSocket per
 * side the moment the caller armed it and transcribed everything either party
 * said, whether or not anything came of it — about eleven classifications a
 * call, of which two or three ever produced a card.
 *
 * Nothing here leaves the browser until somebody presses the button. The audio
 * sits in a ring buffer, which costs nothing, and a press turns the last ten
 * seconds into two short clips. That is roughly a tenth of the cost, and it
 * changes what a wrong answer means: a hint you asked for and disagree with
 * costs a glance, where one that appeared unbidden costs your trust in the
 * thing.
 *
 * Browser-side for the reason it always was: the app dials from a *credential*
 * connection, so these legs are not addressable by the Call Control commands
 * that would fork media server-side. `audio-bridge.ts` documents that wall.
 */

const WORKLET = "/pcm-worklet.js";
const RATE = 8000;

/** How much to keep. Ten seconds covers a sentence and the run-up to it
 *  without dragging in the caller's previous question. */
export const WINDOW_S = 10;
const WINDOW_BYTES = WINDOW_S * RATE;

export type CallAudio = {
  /** The last `WINDOW_S` seconds from each side, as WAV. Null before any audio
   *  has arrived, which is the case for a second or two after a call connects. */
  snapshot: () => { caller: Blob | null; prospect: Blob | null };
  stop: () => void;
};

type Side = "caller" | "prospect";
type Tap = { ctx: AudioContext; node: AudioWorkletNode; src: MediaStreamAudioSourceNode; ring: Uint8Array; at: number; full: boolean };

/** G.711 mu-law back to a 16-bit sample. The worklet encodes; this undoes it
 *  so the clip can be an ordinary PCM WAV, which every transcription endpoint
 *  accepts without argument. */
function decodeMuLaw(u: number): number {
  u = ~u & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

/** Ring contents, oldest first, as a mono 8 kHz PCM WAV. */
function toWav(tap: Tap): Blob | null {
  const n = tap.full ? tap.ring.length : tap.at;
  if (n < RATE / 2) return null; // under half a second is not worth asking about
  const bytes = new Uint8Array(n);
  if (tap.full) {
    bytes.set(tap.ring.subarray(tap.at), 0);
    bytes.set(tap.ring.subarray(0, tap.at), tap.ring.length - tap.at);
  } else {
    bytes.set(tap.ring.subarray(0, n));
  }

  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const put = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  put(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  put(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, "data");
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, decodeMuLaw(bytes[i]), true);
  return new Blob([buf], { type: "audio/wav" });
}

async function makeTap(stream: MediaStream): Promise<Tap> {
  // Native rate, never `{ sampleRate: 8000 }`: Firefox throws when a
  // MediaStreamAudioSourceNode is connected into a differently-rated context.
  // The worklet downsamples instead.
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  await ctx.audioWorklet.addModule(WORKLET);
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-worklet");
  const tap: Tap = { ctx, node, src, ring: new Uint8Array(WINDOW_BYTES), at: 0, full: false };
  node.port.onmessage = (e: MessageEvent<Uint8Array>) => {
    const f = e.data;
    for (let i = 0; i < f.length; i++) {
      tap.ring[tap.at] = f[i];
      tap.at = (tap.at + 1) % tap.ring.length;
      if (tap.at === 0) tap.full = true;
    }
  };
  src.connect(node);
  // Not connected to ctx.destination: routing call audio to the speakers would
  // echo the prospect into the caller's own ear.
  return tap;
}

export async function startCallAudio(opts: {
  prospect: MediaStream;
  /** The caller's own microphone. A fresh `getUserMedia` rather than the call's
   *  sender track: during a merge that track carries the mixed bridge output,
   *  not the caller alone. Permission is granted by the time a call is up. */
  caller: MediaStream;
}): Promise<CallAudio> {
  const taps: Partial<Record<Side, Tap>> = {};
  taps.prospect = await makeTap(opts.prospect);
  try {
    taps.caller = await makeTap(opts.caller);
  } catch {
    // The prospect's side carries the objection. Losing the caller's costs
    // the context that tells an answer from an objection, not the feature.
    taps.caller = undefined;
  }

  let closed = false;
  return {
    snapshot: () => ({
      caller: taps.caller ? toWav(taps.caller) : null,
      prospect: taps.prospect ? toWav(taps.prospect) : null,
    }),
    stop: () => {
      if (closed) return;
      closed = true;
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
    },
  };
}
