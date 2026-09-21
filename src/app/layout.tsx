import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cylrm",
  description: "Internal cold outreach console",
  /**
   * The half of "add this to your home screen" that lives in the head.
   *
   * `appleWebApp` emits `mobile-web-app-capable`, and `manifest.ts` beside
   * this file says `display: standalone`. **Both are needed and neither is
   * cosmetic**: without them iOS treats the home-screen entry as a bookmark,
   * Safari exposes no `PushManager`, and the meeting reminders the Meetings
   * header promises can never arrive however many times somebody adds it.
   *
   * `title` is what goes under the icon — "Call CRM", the name on the
   * workspace switcher, rather than the "cylrm" above, which is the repo's
   * name and means nothing to the floor.
   */
  appleWebApp: {
    capable: true,
    title: "Call CRM",
    // Keeps the status bar legible in both themes; `black-translucent` draws
    // the page under the clock, which the app's own header is not laid out
    // for.
    statusBarStyle: "default",
  },
  // **No `icons` key here, deliberately.** Both icons come from the file
  // convention instead — `src/app/icon.png` for the tab and
  // `src/app/apple-icon.png` for an iPhone home screen — because setting
  // `metadata.icons` at all suppresses the links Next generates from those
  // files. A home-screen icon added on 2026-09-21 declared `icons.icon` and
  // silently replaced the favicon every tab had carried since August; writing
  // `apple` on its own then removed the favicon link altogether rather than
  // restoring it. They are different pictures for different places — the tab
  // keeps the company's mark, the phone gets the app's — and the file
  // convention is the only arrangement that serves both without one standing
  // in for the other.
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${geistMono.variable} h-full antialiased`}
      // The theme script in the app layout adds `dark` to this element before
      // React hydrates, which is what stops a flash of light on a dark browser.
      // Without this, React reports the extra class as a mismatch.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
