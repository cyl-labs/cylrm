/**
 * Turn call audio into 8 kHz mu-law frames for a transcription session.
 *
 * A static file rather than a module in `src/`: `audioWorklet.addModule()` takes
 * a URL and does not go through the bundler cleanly, the same reason
 * `public/sw.js` lives here.
 *
 * The AudioContext is deliberately created at the browser's native rate and the
 * downsampling happens here instead. Building the context at 8000 Hz is the
 * obvious shortcut and it is not portable: remote WebRTC audio runs at 48 kHz
 * internally, Chrome will resample a MediaStreamAudioSourceNode into a
 * differently-rated context, and Firefox throws.
 *
 * Mu-law at 8 kHz rather than the default 24 kHz PCM16 because the session
 * carries audio as base64 inside JSON — roughly a third more bytes than raw —
 * which at 24 kHz is ~512 kbps of upstream per caller on top of the call
 * itself. These callers are in Nigeria. This is ~85 kbps and loses nothing
 * real: the source is 8 kHz telephony that has already been through mu-law.
 */

const TARGET_RATE = 8000;
/** ~20 ms of audio per message. Small enough to keep latency low, large enough
 *  that we are not posting a message per render quantum. */
const FRAME = 160;

/** Standard G.711 mu-law: 16-bit linear sample in, one byte out. */
function encodeMuLaw(sample) {
  const BIAS = 0x84;
  const CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample = sample + BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = [];
    // Fractional read position into the incoming block, advanced by this ratio
    // per output sample. Carried across blocks so the phase does not reset
    // every 128 frames and introduce a periodic artefact.
    this.step = sampleRate / TARGET_RATE;
    this.pos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const chan = input[0];

    // Decimate to 8 kHz by nearest sample. A proper low-pass first would be
    // cleaner, but the source is already band-limited telephony audio and the
    // transcription model is unbothered — measured against real recordings.
    while (this.pos < chan.length) {
      const s = chan[Math.floor(this.pos)];
      const clamped = Math.max(-1, Math.min(1, s));
      this.buf.push(encodeMuLaw(Math.round(clamped * 32767)));
      this.pos += this.step;
    }
    this.pos -= chan.length;

    while (this.buf.length >= FRAME) {
      const frame = new Uint8Array(this.buf.splice(0, FRAME));
      this.port.postMessage(frame, [frame.buffer]);
    }
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
