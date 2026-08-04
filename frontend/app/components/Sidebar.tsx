import Link from "next/link";

const NAV_ITEMS = [
  { label: "Recherche", href: "/app" },
  { label: "Résultats", href: "/app#results" },
  { label: "Campagnes", href: "/campagnes" },
];

export default function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Navigation
      </p>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-700"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
