# LoadLink

Application desktop de téléchargement de vidéos et audio depuis YouTube, Vimeo, TikTok, Instagram et 1800+ autres sites.

Site officiel : [loadlink.fr](https://loadlink.fr)

## Plateformes supportées

- ✅ Windows 10 / 11 (x64)
- ✅ macOS Apple Silicon (M1/M2/M3)
- ✅ macOS Intel
- ⏳ Linux (à venir)

## Builds automatiques

Les builds Windows et macOS sont générés automatiquement par GitHub Actions à chaque tag de version.

Pour déclencher un nouveau build :

```bash
git tag v1.0.2
git push origin v1.0.2
```

Le workflow génère un installeur pour chaque plateforme. Récupère-les dans l'onglet "Actions" du repo.

## Technologies

- [Tauri 2.0](https://tauri.app) (Rust + Webview)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) pour le téléchargement
- [ffmpeg](https://ffmpeg.org) pour la conversion et compression

## Licence

Propriétaire. Tous droits réservés.
