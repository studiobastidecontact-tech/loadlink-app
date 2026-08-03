const NAV_ITEMS = [
  { label: "Recherche", href: "/" },
  { label: "Résultats", href: "/#results" },
  { label: "Exports", href: "/#exports" },
];

export default function Sidebar() {
  return (
    <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-4 md:block">
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
