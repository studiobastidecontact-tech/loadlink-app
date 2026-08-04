import Link from "next/link";

export default function Header() {
  return (
    <header className="flex items-center justify-between border-b border-ink-700 bg-ink px-6 py-3 text-cream">
      <Link href="/" className="flex items-center gap-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-ink">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
          </svg>
        </div>
        <span className="text-lg font-bold tracking-tight">LoadLink</span>
      </Link>
      <Link href="/" className="text-sm font-medium text-cream/60 transition hover:text-accent">
        ← Accueil
      </Link>
    </header>
  );
}
