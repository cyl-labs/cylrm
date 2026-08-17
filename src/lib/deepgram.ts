import type { TranscriptTurn } from "@/db/schema";

/**
 * Speech-to-text, server side only.
 *
 * The recording is dual-channel — the caller on one track, the prospect on the
 * other — so speakers come from *which track the audio is on*, not from a
 * model guessing who is talking. That distinction is the whole reason the
 * outbound voice profile records in dual: diarisation on a noisy cold call is
 * wrong often enough to be useless for the thing this exists to settle, which
 * is whether a meeting was really booked.
 *
 * Deepgram is given a URL rather than an upload. `/api/recordings/[id]` mints a
 * fresh presigned Telnyx link per play, and one of those is what gets passed —
 * so the audio never travels through this server.
 *
 * Unset key means no transcription and nothing else changes, following
 * `lib/notify.ts`: a missing variable disables a feature, it never breaks the
 * screen around it.
 */

const API = "https://api.deepgram.com/v1/listen";
const TIMEOUT_MS = 120_000;

/**
 * Which channel is our caller.
 *
 * Telnyx puts the leg that originated the call on channel 0, so channel 0 is
 * the person dialling and 1 is the prospect. **Confirm this on the first real
 * call** — if the labels come out swapped this constant is the only thing to
 * change, and every stored transcript can be relabelled from it.
 */
const CALLER_CHANNEL = 0;

export function transcriptionConfigured(): boolean {
  return Boolean(process.env.DEEPGRAM_API_KEY);
}

export type Transcript = { text: string; turns: TranscriptTurn[] };

export async function transcribeUrl(url: string): Promise<Transcript> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("Transcription is not configured.");

  // `multichannel` keeps the two tracks apart; `utterances` is what turns a
  // wall of words into the back-and-forth a person can read.
  const query = new URLSearchParams({
    model: "nova-3",
    multichannel: "true",
    utterances: "true",
    punctuate: "true",
    smart_format: "true",
  });

  const res = await fetch(`${API}?${query}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Deepgram refused the recording (${res.status}): ${detail.slice(0, 200)}`,
    );
  }

  const body = (await res.json()) as {
    results?: {
      utterances?: { start: number; channel: number; transcript: string }[];
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };

  const turns: TranscriptTurn[] = (body.results?.utterances ?? [])
    .filter((u) => u.transcript.trim())
    .map((u) => ({
      speaker: u.channel === CALLER_CHANNEL ? "caller" : "prospect",
      start: Math.round(u.start),
      text: u.transcript.trim(),
    }));

  // Built from the turns rather than taken from `channels[].alternatives`,
  // which returns one transcript *per channel* — concatenating those gives one
  // side's half of the call followed by the other's, in the wrong order.
  const text = turns.map((t) => t.text).join(" ");

  return { text, turns };
}
