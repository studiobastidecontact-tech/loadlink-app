import Link from "next/link";

const NAV_ITEMS = [
  { label: "Recherche", href: "/app" },
  { label: "Résultats", href: "/app#results" },
  { label: "Campagnes", href: "/campagnes" },
];

export default function Sidebar() {
  return (
    <aside className="w-full shrink-0 border-b border-slate-200 bg-white p-3 md:w-56 md:border-b-0 md:border-r md:p-4">
      <p className="hidden px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 md:block">
        Navigation
      </p>
      <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-accent/15 hover:text-ink"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
