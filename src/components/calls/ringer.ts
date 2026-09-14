/**
 * The sound and the notification for a call ringing in.
 *
 * Kept out of the provider so the provider reads as the line and nothing else.
 * Both return a stop function, and both are safe to call where the browser
 * offers neither: they simply do nothing.
 */

/**
 * A ringtone, made in the browser rather than shipped as a file.
 *
 * The North American ring cadence — 440 and 480 Hz together, two seconds on
 * and four off — because the floor rings US numbers all day and it is the
 * sound people already read as "a phone is ringing". Quiet enough not to
 * startle anyone wearing a headset, and scheduled two minutes ahead so a tab
 * throttled in the background still keeps time.
 *
 * Browsers only let a page make sound after somebody has clicked something on
 * it. A caller has always pressed a dial or log button long before a callback
 * arrives, so in practice this rings; on a freshly reloaded tab nobody has
 * touched yet it may stay silent, which is what the notification is for.
 */
export function startRingtone(): () => void {
  const Ctx =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
  if (!Ctx) return () => {};

  let ctx: AudioContext;
  try {
    ctx = new Ctx();
  } catch {
    return () => {};
  }
  void ctx.resume().catch(() => {});

  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const tones = [440, 480].map((frequency) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    osc.connect(gain);
    osc.start();
    return osc;
  });

  const start = ctx.currentTime;
  for (let t = 0; t < 120; t += 6) {
    gain.gain.setValueAtTime(0.12, start + t);
    gain.gain.setValueAtTime(0, start + t + 2);
  }

  return () => {
    for (const osc of tones) {
      try {
        osc.stop();
      } catch {
        // Already stopped.
      }
    }
    void ctx.close().catch(() => {});
  };
}

/**
 * A system notification, for a call nobody is looking at the CRM to see.
 *
 * Only when the page is not the focused window: somebody already looking at
 * the banner does not need a second alert on top of it. Only when permission
 * was already granted — the CRM asks for it on first visit for meeting
 * reminders, and asking again mid-ring would be a popup nobody has time for.
 * Clicking it brings the tab forward, where the Answer button is.
 */
export function showIncomingNotification(from: string): () => void {
  if (
    typeof window === "undefined" ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted" ||
    document.hasFocus()
  ) {
    return () => {};
  }

  let note: Notification | null = null;
  try {
    note = new Notification("Incoming call", {
      body: `${from} is calling. Click to answer in the CRM.`,
      tag: "cylrm-incoming-call",
      requireInteraction: true,
    });
    note.onclick = () => {
      window.focus();
      note?.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker; the
    // ringtone and the banner still stand.
  }
  return () => note?.close();
}
