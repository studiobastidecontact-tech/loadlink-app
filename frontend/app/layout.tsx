import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoadLink — Prospection commerciale",
  description: "Trouvez et exportez vos prospects locaux en quelques secondes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
