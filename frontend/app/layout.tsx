import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoadLink — Trouvez vos prospects partout en France",
  description:
    "Moteur de prospection universel : trouvez n'importe quelle activité, récupérez les coordonnées publiques, suivez vos prospects et lancez vos campagnes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
