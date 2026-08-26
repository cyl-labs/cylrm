/**
 * Two calls, one conversation.
 *
 * Telnyx will conference legs together server-side, but only for calls placed
 * through a Call Control application. This app dials from a *credential*
 * connection — the only kind a WebRTC softphone can register against — and
 * those legs are not addressable by the Call Control commands that would build
 * a conference. So the bridge is here, in the browser, where both calls
 * already terminate.
 *
 * The wiring is the whole idea: each leg is sent the microphone plus *the
 * other leg's* audio, and nothing is ever fed back into the leg it came from.
 *
 *     mic ─┬──────────────┐
 *          │              ▼
 *          │        [ mix → leg A ]  ◀── audio arriving from leg B
 *          │              ▲
 *          └──────────────┤
 *                   [ mix → leg B ]  ◀── audio arriving from leg A
 *
 * Nothing is renegotiated. `replaceTrack` swaps what a live sender carries
 * without touching the SDP, so neither far end sees anything happen: the
 * prospect simply starts hearing a second voice.
 *
 * Its own `getUserMedia` rather than borrowing a call's microphone, because
 * either call can end first and stopping its tracks would take the mix with
 * it. Permission was granted when the first call was placed, so this asks the
 * caller for nothing.
 */

/** The parts of a Telnyx call this needs. Both are on the SDK's public call
 *  interface (`IWebRTCCall`). */
type Leg = {
  remoteStream?: MediaStream | null;
  peer?: { instance?: RTCPeerConnection | null } | null;
};

export type AudioBridge = {
  /**
   * Mute the caller on both legs at once, which is what a mute button means
   * on a conference. The two far ends go on hearing each other.
   */
  setMuted: (muted: boolean) => void;
  /** Put both legs back on their own microphone and tear the graph down. */
  close: () => void;
};

function audioSender(leg: Leg): RTCRtpSender {
  const pc = leg.peer?.instance;
  if (!pc) throw new Error("Call has no peer connection.");
  const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
  if (!sender) throw new Error("Call has no audio sender.");
  return sender;
}

function remoteSource(ctx: AudioContext, leg: Leg): MediaStreamAudioSourceNode {
  const stream = leg.remoteStream;
  if (!stream || stream.getAudioTracks().length === 0) {
    throw new Error("Call has no incoming audio yet.");
  }
  return ctx.createMediaStreamSource(stream);
}

/**
 * Join two live calls so that everyone on them can hear everyone else.
 *
 * Throws if either call is not carrying audio yet — the caller merges on
 * "active", so that is a bug rather than a race, and it must surface rather
 * than leave a merge button that silently does nothing.
 */
export async function bridgeCalls(a: Leg, b: Leg): Promise<AudioBridge> {
  const senderA = audioSender(a);
  const senderB = audioSender(b);
  // Kept so both legs can be handed back their own microphone afterwards.
  const ownTrackA = senderA.track;
  const ownTrackB = senderB.track;

  const mic = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const ctx = new AudioContext();
  const stop = () => {
    for (const t of mic.getTracks()) {
      try {
        t.stop();
      } catch {
        // Already stopped; nothing to undo.
      }
    }
    void ctx.close().catch(() => {});
  };

  try {
    // Merging is a button press, so the context is created inside a gesture
    // and should start running. Resumed anyway: a suspended context produces
    // silence on both legs, which is the worst way for this to fail.
    if (ctx.state === "suspended") await ctx.resume();

    const micSource = ctx.createMediaStreamSource(mic);
    const fromA = remoteSource(ctx, a);
    const fromB = remoteSource(ctx, b);
    const toA = ctx.createMediaStreamDestination();
    const toB = ctx.createMediaStreamDestination();

    micSource.connect(toA);
    micSource.connect(toB);
    fromB.connect(toA);
    fromA.connect(toB);

    await senderA.replaceTrack(toA.stream.getAudioTracks()[0]);
    try {
      await senderB.replaceTrack(toB.stream.getAudioTracks()[0]);
    } catch (err) {
      // Half a bridge is worse than none: the prospect would hear the demo
      // while the demo heard nobody. Put the first leg back before rethrowing.
      await senderA.replaceTrack(ownTrackA).catch(() => {});
      throw err;
    }

    return {
      setMuted: (muted: boolean) => {
        for (const t of mic.getAudioTracks()) t.enabled = !muted;
      },
      close: () => {
        // Best effort throughout. By the time this runs one of the calls has
        // usually ended, and a sender on a closed connection rejects.
        void senderA.replaceTrack(ownTrackA).catch(() => {});
        void senderB.replaceTrack(ownTrackB).catch(() => {});
        for (const node of [micSource, fromA, fromB]) {
          try {
            node.disconnect();
          } catch {
            // Already detached.
          }
        }
        stop();
      },
    };
  } catch (err) {
    stop();
    throw err;
  }
}
