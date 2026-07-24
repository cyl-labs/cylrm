export function PageShell({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-svh flex-col">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 gap-y-2 border-b bg-card px-7 py-2.5">
        <h1 className="text-xl font-extrabold tracking-[-0.02em]">{title}</h1>
        {actions && (
          <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
