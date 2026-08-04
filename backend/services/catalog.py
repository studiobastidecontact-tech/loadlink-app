"""
services/catalog.py

Moteur d'activités universel de LoadLink.

Charge le catalogue généré (services/catalog.json — dérivé des presets
OpenStreetMap iD, voir scripts/build_catalog.py) et fournit :

    search(q, limit)      -> autocomplétion FR insensible aux accents
    build_osm_tags(ids)   -> dict de tags OSM pour la recherche Overpass
    label_for(key, value) -> libellé FR d'un tag (pour l'affichage des résultats)

Aucune catégorie n'est codée en dur ici : tout vient de catalog.json.
Pour ajouter des activités, régénérer le catalogue — pas de code à toucher.
"""

from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

_CATALOG_PATH = Path(__file__).with_name("catalog.json")


def _normalize(text: str) -> str:
    """Minuscule + suppression des accents, pour une recherche tolérante
    (« cine » doit matcher « Cinéma », « ecole » doit matcher « École »)."""
    if not text:
        return ""
    text = text.strip().lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return text


class _Entry:
    __slots__ = ("id", "label", "group", "key", "value", "terms",
                 "_norm_label", "_norm_terms", "_norm_all")

    def __init__(self, raw: dict):
        self.id: str = raw["id"]
        self.label: str = raw["label"]
        self.group: str = raw.get("group", "Autres")
        self.key: str = raw["key"]
        self.value: str = raw["value"]
        self.terms: list[str] = raw.get("terms", [])
        self._norm_label = _normalize(self.label)
        self._norm_terms = [_normalize(t) for t in self.terms]
        self._norm_all = [self._norm_label] + self._norm_terms

    def as_option(self) -> dict:
        return {"key": self.id, "label": self.label, "group": self.group}


@lru_cache(maxsize=1)
def _entries() -> list[_Entry]:
    raw = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return [_Entry(item) for item in raw]


@lru_cache(maxsize=1)
def _by_id() -> dict[str, _Entry]:
    return {e.id: e for e in _entries()}


@lru_cache(maxsize=1)
def _by_key_value() -> dict[tuple[str, str], _Entry]:
    return {(e.key, e.value): e for e in _entries()}


def _words(text: str) -> list[str]:
    return text.replace("'", " ").replace("-", " ").split()


def _score_single(text: str, nq: str, is_label: bool) -> Optional[int]:
    """Score d'un texte (label ou synonyme) contre une requête à un seul mot."""
    if text == nq:
        return 0 if is_label else 1
    if text.startswith(nq):
        return 2 if is_label else 3
    if any(word.startswith(nq) for word in _words(text)):
        return 3 if is_label else 4
    if nq in text:
        return 5 if is_label else 6
    return None


def _score(entry: _Entry, nq: str) -> Optional[int]:
    """Retourne un score de pertinence (plus petit = meilleur), ou None si
    l'entrée ne correspond pas à la requête normalisée `nq`.

    Requête multi-mots (ex. « expert compta ») : chaque mot doit se
    retrouver (en préfixe/sous-chaîne) dans le label ou les synonymes.
    """
    query_tokens = nq.split()
    best: Optional[int] = None

    for idx, text in enumerate(entry._norm_all):
        is_label = idx == 0
        if len(query_tokens) <= 1:
            rank = _score_single(text, nq, is_label)
        else:
            # Tous les tokens doivent matcher ce texte ; score = pire des tokens.
            ranks = [_score_single(text, tok, is_label) for tok in query_tokens]
            rank = max(ranks) if all(r is not None for r in ranks) else None
        if rank is not None and (best is None or rank < best):
            best = rank
    return best


def search(q: str, limit: int = 12) -> list[dict]:
    """Autocomplétion : renvoie les activités correspondant à `q`,
    triées par pertinence puis par libellé. `q` vide -> liste vide.

    Les activités partageant le même libellé mais des tags OSM différents
    (ex. « Serrurier » = craft=locksmith ET shop=locksmith) sont fusionnées
    en une seule suggestion, dont la clé regroupe tous les tags (séparés par
    des virgules) afin d'interroger l'ensemble en une recherche."""
    nq = _normalize(q)
    if not nq:
        return []

    # Regroupe par libellé normalisé.
    groups: dict[str, dict] = {}
    for entry in _entries():
        rank = _score(entry, nq)
        if rank is None:
            continue
        g = groups.get(entry._norm_label)
        if g is None:
            groups[entry._norm_label] = {
                "ids": [entry.id],
                "label": entry.label,
                "group": entry.group,
                "rank": rank,
                "norm": entry._norm_label,
            }
        else:
            g["ids"].append(entry.id)
            g["rank"] = min(g["rank"], rank)

    ordered = sorted(groups.values(), key=lambda g: (g["rank"], len(g["norm"]), g["norm"]))
    return [
        {"key": ",".join(g["ids"]), "label": g["label"], "group": g["group"]}
        for g in ordered[:limit]
    ]


def build_osm_tags(ids: Optional[Iterable[str]]) -> dict[str, list[str]]:
    """Construit le dict de tags OSM (union) pour les ids de catégories
    sélectionnés (« office=lawyer », « amenity=cinema »...). ids vide ou
    None -> {} (l'appelant décide alors du comportement par défaut)."""
    tags: dict[str, list[str]] = {}
    if not ids:
        return tags
    catalog = _by_id()
    for cid in ids:
        entry = catalog.get(cid)
        if entry is None:
            # Tolérance : accepte aussi la forme "cle=valeur" hors catalogue.
            if "=" in cid:
                key, _, value = cid.partition("=")
                key, value = key.strip(), value.strip()
                if key and value:
                    tags.setdefault(key, [])
                    if value not in tags[key]:
                        tags[key].append(value)
            continue
        tags.setdefault(entry.key, [])
        if entry.value not in tags[entry.key]:
            tags[entry.key].append(entry.value)
    return tags


def label_for(key: str, value: str) -> Optional[str]:
    """Libellé FR pour un tag OSM (affichage des résultats). None si inconnu."""
    entry = _by_key_value().get((key, value))
    return entry.label if entry else None


def known_id(cid: str) -> bool:
    return cid in _by_id()


def count() -> int:
    return len(_entries())
