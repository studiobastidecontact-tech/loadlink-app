#!/usr/bin/env python3
"""
build_catalog.py — Génère le catalogue universel d'activités de LoadLink.

Le catalogue N'EST PAS écrit à la main : il est dérivé de la base de
« presets » officielle de l'éditeur OpenStreetMap iD
(paquet npm @openstreetmap/id-tagging-schema), qui est communautaire,
maintenue en continu et déjà traduite en français.

Résultat : backend/services/catalog.json
    Liste d'activités « prospectables » (établissements / professions),
    chacune avec :
        id       : "<clé>=<valeur>" OSM (ex. "office=lawyer") — identifiant unique
        label    : libellé français affiché à l'utilisateur
        group    : regroupement thématique (affichage)
        terms    : synonymes français pour l'autocomplétion
        key/value: le tag OSM à interroger via Overpass

Pour ajouter/mettre à jour des activités, il suffit de relancer ce
script (il récupère la dernière version des presets). Aucune liste
n'est maintenue à la main dans le code.

Vocabulaire métier manquant dans OSM (ex. « boîte de production ») :
voir backend/services/aliases.json — on y ajoute des synonymes français
qui pointent vers un preset existant. C'est le seul fichier à éditer à
la main, et il ne contient que des synonymes, pas de logique.

Usage :
    python scripts/build_catalog.py
    python scripts/build_catalog.py --schema-dir /chemin/vers/node_modules/@openstreetmap/id-tagging-schema
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Clés OSM correspondant à des activités « prospectables »
# (établissements, commerces, bureaux, professions, artisans, loisirs...).
# On exclut volontairement les clés non commerciales (highway, natural,
# barrier, power, man_made, building seul, etc.).
BUSINESS_KEYS = {
    "amenity",
    "shop",
    "office",
    "craft",
    "tourism",
    "leisure",
    "healthcare",
    "club",
}

# Quelques valeurs à exclure même si la clé est « business » : ce ne sont
# pas des cibles de prospection (mobilier urbain, équipements publics
# gratuits sans exploitant commercial identifiable, presets obsolètes ou
# « non précisés », etc.).
EXCLUDED_VALUES = {
    ("amenity", "bench"),
    ("amenity", "waste_basket"),
    ("amenity", "recycling"),
    ("amenity", "toilets"),
    ("amenity", "drinking_water"),
    ("amenity", "fountain"),
    ("amenity", "bicycle_parking"),
    ("amenity", "parking"),
    ("amenity", "parking_space"),
    ("amenity", "parking_entrance"),
    ("amenity", "grave_yard"),
    ("amenity", "shelter"),
    ("amenity", "bbq"),
    ("amenity", "clock"),
    ("amenity", "telephone"),
    ("amenity", "vending_machine"),
    ("amenity", "charging_station"),
    ("amenity", "post_box"),
    ("tourism", "viewpoint"),
    ("tourism", "artwork"),
    ("tourism", "picnic_site"),
    ("leisure", "picnic_table"),
    ("leisure", "firepit"),
    ("leisure", "slipway"),
    # Presets « fourre-tout », obsolètes ou non précisés : bruit pour la prospection.
    ("office", "yes"),
    ("office", "physician"),
    ("shop", "yes"),
    ("shop", "hobby"),
    ("healthcare", "yes"),
}

# Libellés FR pour les quelques presets non traduits dans id-tagging-schema
# (surtout l'enseignement, dont le nom d'origine est « ... Grounds »).
# C'est une petite correction ponctuelle, pas une liste de catégories.
LABEL_OVERRIDES = {
    "amenity=school": "École",
    "amenity=college": "Collège / Lycée",
    "amenity=university": "Université",
    "amenity=kindergarten": "Crèche / École maternelle",
    "amenity=dancing_school": "École de danse",
    "amenity=driving_school": "Auto-école",
    "amenity=language_school": "École de langues",
    "amenity=music_school": "École de musique",
    "amenity=prep_school": "Soutien scolaire / Prépa",
    "amenity=coworking_space": "Espace de coworking",
    "amenity=traffic_park": "Piste d'éducation routière",
    "shop=ice_cream": "Glacier",
}

# Regroupements thématiques pour l'affichage, par clé OSM principale.
GROUP_BY_KEY = {
    "amenity": "Services & Établissements",
    "shop": "Commerces",
    "office": "Bureaux & Professions",
    "craft": "Artisanat & BTP",
    "tourism": "Tourisme & Hébergement",
    "leisure": "Sport & Loisirs",
    "healthcare": "Santé",
    "club": "Associations & Clubs",
}

ROOT = Path(__file__).resolve().parents[1]  # backend/
OUT_PATH = ROOT / "services" / "catalog.json"
ALIASES_PATH = ROOT / "services" / "aliases.json"

PACKAGE = "@openstreetmap/id-tagging-schema"


def _ensure_schema_dir(explicit: str | None) -> Path:
    """Retourne le dossier du paquet id-tagging-schema, en l'installant
    via npm dans un dossier temporaire si nécessaire."""
    if explicit:
        p = Path(explicit)
        if not (p / "dist" / "presets.json").exists():
            sys.exit(f"[erreur] presets.json introuvable dans {p}")
        return p

    # Cherche une install locale déjà présente (scripts/node_modules).
    local = ROOT / "scripts" / "node_modules" / "@openstreetmap" / "id-tagging-schema"
    if (local / "dist" / "presets.json").exists():
        return local

    print("[info] Installation de", PACKAGE, "via npm…", flush=True)
    workdir = ROOT / "scripts"
    try:
        subprocess.run(
            ["npm", "install", "--no-save", "--no-audit", "--no-fund", PACKAGE],
            cwd=workdir,
            check=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        sys.exit(
            "[erreur] Impossible d'installer id-tagging-schema via npm "
            f"({exc}). Installe-le manuellement puis relance avec "
            "--schema-dir <chemin>."
        )
    if not (local / "dist" / "presets.json").exists():
        sys.exit("[erreur] Installation npm terminée mais presets.json introuvable.")
    return local


def _load(schema_dir: Path) -> tuple[dict, dict, dict]:
    presets = json.loads((schema_dir / "dist" / "presets.json").read_text(encoding="utf-8"))
    fr = json.loads((schema_dir / "dist" / "translations" / "fr.json").read_text(encoding="utf-8"))
    en = json.loads((schema_dir / "dist" / "translations" / "en.json").read_text(encoding="utf-8"))
    fr_presets = fr["fr"]["presets"]["presets"]
    en_presets = en["en"]["presets"]["presets"]
    return presets, fr_presets, en_presets


def build(schema_dir: Path) -> list[dict]:
    presets, fr_presets, en_presets = _load(schema_dir)

    catalog: list[dict] = []
    seen_ids: set[str] = set()

    for pid, preset in presets.items():
        tags = preset.get("tags", {})
        # On ne garde que les presets à TAG UNIQUE : Overpass ne peut pas
        # interroger proprement une conjonction de deux tags en union.
        if len(tags) != 1:
            continue
        (key, value), = tags.items()
        if key not in BUSINESS_KEYS:
            continue
        if value in ("*", ""):
            continue
        if (key, value) in EXCLUDED_VALUES:
            continue

        geometry = preset.get("geometry", [])
        if "point" not in geometry and "area" not in geometry:
            continue
        # NB : on n'exclut PAS les presets « searchable:false » du schéma iD.
        # Beaucoup sont des cibles de prospection valides (école, université,
        # auto-école, coworking, serrurier...) qu'iD masque juste de sa propre
        # recherche d'édition. On s'appuie sur BUSINESS_KEYS + EXCLUDED_VALUES.

        cid = f"{key}={value}"
        fr_entry = fr_presets.get(pid, {})
        label = (
            fr_entry.get("name")
            or LABEL_OVERRIDES.get(cid)
            or en_presets.get(pid, {}).get("name")
            or value.replace("_", " ").capitalize()
        )
        if not label:
            continue

        raw_terms = fr_entry.get("terms", [])
        if isinstance(raw_terms, str):
            terms = [t.strip() for t in raw_terms.split(",") if t.strip()]
        else:
            terms = [str(t).strip() for t in raw_terms if str(t).strip()]

        if cid in seen_ids:
            continue
        seen_ids.add(cid)

        catalog.append(
            {
                "id": cid,
                "label": label,
                "group": GROUP_BY_KEY.get(key, "Autres"),
                "key": key,
                "value": value,
                "terms": terms,
            }
        )

    # Fusion des alias métier (synonymes français supplémentaires).
    if ALIASES_PATH.exists():
        aliases = json.loads(ALIASES_PATH.read_text(encoding="utf-8"))
        by_id = {c["id"]: c for c in catalog}
        added = 0
        for cid, extra_terms in aliases.items():
            if cid.startswith("_"):
                continue  # clés de documentation (ex. "_comment")
            target = by_id.get(cid)
            if not target:
                print(f"[avertissement] alias ignoré, id inconnu : {cid}")
                continue
            for t in extra_terms:
                if t not in target["terms"]:
                    target["terms"].append(t)
                    added += 1
        print(f"[info] {added} synonyme(s) métier ajouté(s) depuis aliases.json")

    catalog.sort(key=lambda c: (c["group"], c["label"]))
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser(description="Génère catalog.json depuis id-tagging-schema.")
    parser.add_argument("--schema-dir", default=os.environ.get("ID_SCHEMA_DIR"))
    args = parser.parse_args()

    schema_dir = _ensure_schema_dir(args.schema_dir)
    catalog = build(schema_dir)
    OUT_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(f"[ok] {len(catalog)} activités écrites dans {OUT_PATH.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()
