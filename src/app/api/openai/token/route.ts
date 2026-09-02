import { getCurrentUser } from "@/lib/session";
import { canUseLiveHints } from "@/lib/users";

/**
 * A short-lived credential for the browser's transcription session.
 *
 * Mirrors `/api/telnyx/token`: returns the secret and nothing else, and needs a
 * real user rather than just a session — a cookie that can write a call row is
 * a different thing from one that can spend money on our OpenAI account.
 *
 * The browser talks to OpenAI directly rather than through here. Relaying audio
 * would put a WebSocket and a continuous byte stream through a 1 vCPU droplet
 * shared with four other apps, for no gain: the same reasoning that has
 * `/api/recordings/[id]` mint a presigned URL per play instead of proxying the
 * audio itself.
 */

const SESSIONS = "https://api.openai.com/v1/realtime/client_secrets";
const TIMEOUT_MS = 10_000;

export async function POST() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const key = process.env.OPENAI_API_KEY;
  // Gated on the flag *and* the key. Checking only the key would leave
  // `LIVE_HINTS=0` still minting credentials, and the rollback plan claims this
  // flag is the single switch — so it has to actually be one.
  if (!key || process.env.LIVE_HINTS !== "1") {
    return Response.json({ error: "Live hints are off." }, { status: 503 });
  }

  // Granted per person while the feature is in testing. Enforced here rather
  // than by hiding the button: a hidden control is a courtesy, and anyone with
  // the browser console walks straight past it.
  if (!(await canUseLiveHints(me.id))) {
    return Response.json({ error: "No live hints access." }, { status: 403 });
  }

  try {
    const res = await fetch(SESSIONS, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        session: {
          type: "transcription",
          audio: {
            input: {
              // `audio/pcmu` is mu-law at 8 kHz, which is what the worklet
              // emits. Verified against the live API with real call audio.
              format: { type: "audio/pcmu" },
              transcription: { model: "gpt-4o-mini-transcribe" },
              // Server-side voice activity detection gives us utterance
              // boundaries. Without it we would be guessing where a sentence
              // ends, and the measurement work showed segmentation matters as
              // much as the model does.
              turn_detection: { type: "server_vad", silence_duration_ms: 400 },
            },
          },
        },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      // Logged as well as returned: this route failing is invisible from the
      // dialler by design, and a 404 from a changed API shape is exactly the
      // thing that leaves "Listening" on screen forever with no explanation.
      console.error("[openai/token] session refused", res.status, detail);
      return Response.json(
        { error: `OpenAI refused a session (${res.status}): ${detail}` },
        { status: 502 },
      );
    }
    const json = (await res.json()) as { value?: string };
    const secret = json.value;
    if (!secret) {
      return Response.json({ error: "No client secret returned." }, { status: 502 });
    }
    return Response.json({ token: secret });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not open a session." },
      { status: 502 },
    );
  }
}
