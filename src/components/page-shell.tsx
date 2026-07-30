import { isDemoMode } from "@/lib/demo";
import { MobileNav } from "@/components/mobile-nav";

export async function PageShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const demo = await isDemoMode();
  return (
    <div className="flex h-svh flex-col">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 gap-y-2 border-b bg-card px-4 py-2.5 sm:px-7">
        <MobileNav demo={demo} />
        <h1 className="text-lg font-extrabold tracking-[-0.02em] sm:text-xl">
          {title}
        </h1>
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </header>
      {/* `relative` makes this the containing block for absolutely positioned
          descendants. Without it, `sr-only` spans (position: absolute, no
          positioned ancestor) resolve against the viewport instead, escape the
          overflow clip, and give tall pages a second window-level scrollbar
          into empty space. */}
      <div className="relative min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
