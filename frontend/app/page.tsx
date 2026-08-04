import Link from "next/link";

/* ---------- Utilitaires visuels ---------- */

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function Grain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay"
      style={{ backgroundImage: GRAIN }}
    />
  );
}

function Bracket({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">
      [ {children} ]
    </span>
  );
}

function Icon({ path }: { path: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      {path}
    </svg>
  );
}

const ICONS = {
  bolt: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  contact: <><path d="M4 4h16v16H4z" /><path d="m4 7 8 5 8-5" /></>,
  crm: <><path d="M3 3v18h18" /><path d="m7 14 3-3 3 3 4-5" /></>,
  export: <><path d="M12 3v12" /><path d="m8 11 4 4 4-4" /><path d="M4 21h16" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /></>,
  map: <><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15M15 6v15" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

/* ---------- Nav ---------- */

function TopNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-30">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="leading-none">
          <span className="block text-sm font-semibold text-cream">Load</span>
          <span className="block text-sm font-semibold text-cream/70">Link</span>
        </div>
        <nav className="hidden items-center gap-8 text-xs font-semibold uppercase tracking-[0.15em] text-cream/70 md:flex">
          <a href="#how" className="hover:text-accent">Comment ça marche</a>
          <a href="#features" className="hover:text-accent">Fonctionnalités</a>
          <a href="#roadmap" className="hover:text-accent">À venir</a>
        </nav>
        <Link
          href="/app"
          className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition hover:bg-accent-400"
        >
          Ouvrir l'app <Icon path={ICONS.arrow} />
        </Link>
      </div>
    </header>
  );
}

/* ---------- Hero ---------- */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-ink">
      <Grain />
      {/* halo lime discret */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #CBF24E, transparent)" }}
      />
      <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-36 sm:pt-44">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 text-cream">
            <span className="inline-flex items-center gap-2 rounded-full border border-cream/20 px-3 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <Bracket>Prospection B2B · France</Bracket>
            </span>
          </div>

          <h1 className="max-w-4xl text-6xl font-black leading-[0.92] tracking-tight text-cream sm:text-8xl">
            Prospectez{" "}
            <span className="text-accent">toute la France.</span>
          </h1>

          <p className="max-w-xl text-lg text-cream/70">
            Choisissez une zone, tapez n'importe quelle activité, et récupérez la
            liste des entreprises avec leurs coordonnées publiques. Qualifiez,
            exportez, lancez vos campagnes.
          </p>

          <div className="mt-2 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link
              href="/app"
              className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition hover:bg-accent-400"
            >
              Lancer une recherche <Icon path={ICONS.arrow} />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-full border border-cream/25 px-6 py-3 text-sm font-semibold text-cream transition hover:border-accent hover:text-accent"
            >
              Comment ça marche
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- À propos + stats (olive) ---------- */

const STATS = [
  { value: "477", label: "Activités recherchables" },
  { value: "34 000+", label: "Communes couvertes" },
  { value: "100 %", label: "Données publiques, gratuit" },
];

function About() {
  return (
    <section className="relative overflow-hidden bg-olive text-cream">
      <Grain />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-[1fr_1.4fr]">
        <div>
          <Bracket>À propos</Bracket>
        </div>
        <div>
          <p className="text-2xl font-medium leading-snug sm:text-3xl">
            LoadLink transforme les données ouvertes en un vrai fichier de
            prospection. Un seul endroit pour trouver les entreprises d'un
            secteur, récupérer leurs contacts, les qualifier et les relancer.
          </p>
          <div className="mt-12 grid grid-cols-1 gap-8 border-t border-cream/15 pt-8 sm:grid-cols-3">
            {STATS.map((s) => (
              <div key={s.label}>
                <p className="text-4xl font-black text-accent">{s.value}</p>
                <p className="mt-1 text-sm text-cream/70">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Comment ça marche (crème) ---------- */

const STEPS = [
  { n: "01", title: "Choisissez la zone", text: "Région, département, ville et rayon autour du point choisi." },
  { n: "02", title: "Cherchez une activité", text: "Tapez « avocat », « cinéma », « garagiste »… l'autocomplétion trouve la catégorie." },
  { n: "03", title: "Récupérez les entreprises", text: "Nom, adresse, téléphone, email et site web, depuis les données publiques." },
  { n: "04", title: "Exportez & prospectez", text: "Sélectionnez, exportez en CSV/Excel, suivez vos statuts et lancez vos campagnes." },
];

function HowItWorks() {
  return (
    <section id="how" className="bg-cream text-ink">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Trouver et contacter des entreprises n'a jamais été aussi simple.
          </h2>
          <Bracket>Comment ça marche</Bracket>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 sm:grid-cols-2">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-cream p-8">
              <Bracket>{s.n}</Bracket>
              <h3 className="mt-4 text-xl font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-ink/70">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Fonctionnalités (encre) ---------- */

const FEATURES = [
  { icon: ICONS.search, title: "Recherche universelle", text: "Des centaines d'activités, de l'avocat au vidéaste. Vous tapez en français, LoadLink trouve les bons établissements." },
  { icon: ICONS.contact, title: "Coordonnées publiques", text: "Téléphone et email récupérés depuis les données ouvertes et les sites web (pages contact, mentions légales)." },
  { icon: ICONS.crm, title: "Mini-CRM intégré", text: "Un statut et des notes par entreprise pour piloter votre prospection dans la durée." },
  { icon: ICONS.export, title: "Export CSV & Excel", text: "Toute la liste ou seulement votre sélection, avec statuts et notes, en un clic." },
  { icon: ICONS.send, title: "Campagnes d'emails", text: "Messages personnalisés ({{nom}}, {{ville}}), brouillons prêts à envoyer et historique." },
  { icon: ICONS.map, title: "Actions rapides", text: "Lien direct vers le site, Google Maps et une recherche « nom + ville » en un clic." },
];

function Features() {
  return (
    <section id="features" className="relative overflow-hidden bg-ink text-cream">
      <Grain />
      <div className="relative mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Tout pour prospecter</h2>
          <Bracket>Fonctionnalités</Bracket>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-cream/10 bg-ink-800 p-6 transition hover:border-accent/50">
              <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-accent text-ink">
                <Icon path={f.icon} />
              </div>
              <h3 className="text-base font-semibold text-cream">{f.title}</h3>
              <p className="mt-2 text-sm text-cream/60">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Roadmap (olive) ---------- */

const ROADMAP = [
  { n: "01", title: "Comptes & sauvegarde en ligne", text: "Vos prospects et campagnes depuis n'importe quel appareil." },
  { n: "02", title: "Couverture enrichie", text: "Plus de téléphones et d'emails via Google Places et SIRENE." },
  { n: "03", title: "Envoi & relances automatiques", text: "Campagnes envoyées et suivies, dans le respect du RGPD." },
];

function Roadmap() {
  return (
    <section id="roadmap" className="bg-olive text-cream">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Ce qui arrive</h2>
          <Bracket>En développement</Bracket>
        </div>
        <div className="mt-10 divide-y divide-cream/15 border-y border-cream/15">
          {ROADMAP.map((r) => (
            <div key={r.n} className="flex flex-col gap-2 py-6 sm:flex-row sm:items-baseline sm:gap-10">
              <span className="text-sm font-semibold text-accent">[ {r.n} ]</span>
              <h3 className="w-64 shrink-0 text-lg font-semibold">{r.title}</h3>
              <p className="text-sm text-cream/70">{r.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- CTA (lime) ---------- */

function CtaBand() {
  return (
    <section className="bg-accent text-ink">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-6 py-16 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="max-w-xl text-3xl font-black tracking-tight sm:text-5xl">
          Prêt à trouver vos prospects ?
        </h2>
        <Link
          href="/app"
          className="inline-flex items-center gap-2 rounded-full bg-ink px-7 py-4 text-sm font-semibold text-cream transition hover:bg-ink-800"
        >
          Ouvrir LoadLink <Icon path={ICONS.arrow} />
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-ink text-cream">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-10 text-sm text-cream/50 sm:flex-row">
        <div className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-md bg-accent text-ink">
            <Icon path={ICONS.bolt} />
          </div>
          <span className="font-semibold text-cream">LoadLink</span>
        </div>
        <p>Données publiques OpenStreetMap · 2026</p>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-ink font-sans">
      <TopNav />
      <main>
        <Hero />
        <About />
        <HowItWorks />
        <Features />
        <Roadmap />
        <CtaBand />
      </main>
      <Footer />
    </div>
  );
}
