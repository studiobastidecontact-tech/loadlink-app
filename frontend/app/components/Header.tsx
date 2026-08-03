export default function Header() {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-brand" />
        <span className="text-lg font-semibold tracking-tight">LoadLink</span>
      </div>
      <nav className="text-sm text-slate-500">Prospection commerciale</nav>
    </header>
  );
}
