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
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <h1 className="text-sm font-semibold tracking-[-0.01em]">{title}</h1>
        {actions && (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}
