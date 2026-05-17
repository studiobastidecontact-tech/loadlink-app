# LoadLink

Outil desktop local de capture, conversion et archivage multimédia.

Conçu pour les **créateurs, journalistes, chercheurs et archivistes** ayant besoin de sauvegarder, convertir ou archiver localement des fichiers média dont ils détiennent les droits ou dont l'accès est légitime (contenus propres, sources libres de droits, exercice du droit à la portabilité — art. 20 RGPD).

Site officiel : [loadlink.fr](https://loadlink.fr)

## Plateformes supportées

- ✅ Windows 10 / 11 (x64)
- ⏳ macOS (à venir)
- ⏳ Linux (à venir)

## Fonctionnalités

- Capture de flux média accessibles vers conteneurs standards (MP4, WEBM)
- Extraction de pistes audio (WAV, FLAC, M4A, OGG, AAC)
- Traitement par lot
- Réencodage local en H.265 pour optimisation du stockage
- Archivage ZIP de dossiers
- **Traitement 100% local** — aucun serveur, aucune télémétrie, aucune collecte

## Stack technique

- [Tauri 2.0](https://tauri.app) — runtime desktop (Rust + Webview)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — moteur de capture (Unlicense)
- [FFmpeg](https://ffmpeg.org) — conversion et compression (LGPL v2.1+)

## Responsabilité de l'utilisateur

LoadLink est un **outil technique neutre**. L'utilisateur est seul responsable du respect des droits de propriété intellectuelle et des conditions d'utilisation des services tiers depuis lesquels il accède aux contenus qu'il traite.

Pour le détail, voir les [mentions légales](https://loadlink.fr/legal.html) sur le site officiel.

## Licence

Propriétaire. Tous droits réservés.