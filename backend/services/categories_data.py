"""
services/categories_data.py

Catalogue des catégories d'établissements/professions proposées à
l'autocomplétion. C'est la SEULE source à modifier pour ajouter une
nouvelle catégorie : ajouter une entrée à CATEGORY_CATALOG suffit,
aucune autre partie du code n'a besoin d'être touchée.

Chaque entrée :
    key      : "<clé_osm>=<valeur_osm>", identifiant unique (ex: "office=lawyer")
    label    : libellé affiché en français
    group    : regroupement thématique (affichage uniquement)
    synonyms : termes alternatifs qui doivent aussi faire remonter cette entrée

Référence des tags : https://wiki.openstreetmap.org/wiki/FR:Carte_des_symboles
"""

CATEGORY_CATALOG: list[dict] = [
    # --- Restauration & Hébergement ---
    {"key": "amenity=restaurant", "label": "Restaurant", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "amenity=bar", "label": "Bar", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "amenity=cafe", "label": "Café", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "amenity=pub", "label": "Pub", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "amenity=fast_food", "label": "Fast-food", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "amenity=biergarten", "label": "Brasserie", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "amenity=ice_cream", "label": "Glacier", "group": "Restauration & Hébergement", "synonyms": ["glace"]},
    {"key": "amenity=nightclub", "label": "Boîte de nuit", "group": "Restauration & Hébergement", "synonyms": ["discothèque", "club"]},
    {"key": "amenity=casino", "label": "Casino", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "tourism=hotel", "label": "Hôtel", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "tourism=guest_house", "label": "Chambre d'hôtes", "group": "Restauration & Hébergement", "synonyms": ["guest house"]},
    {"key": "tourism=hostel", "label": "Auberge de jeunesse", "group": "Restauration & Hébergement", "synonyms": ["hostel"]},
    {"key": "tourism=camp_site", "label": "Camping", "group": "Restauration & Hébergement", "synonyms": []},
    {"key": "tourism=chalet", "label": "Chalet / Location de vacances", "group": "Restauration & Hébergement", "synonyms": []},

    # --- Droit, Finance & Conseil ---
    {"key": "office=lawyer", "label": "Avocat", "group": "Droit, Finance & Conseil", "synonyms": ["cabinet d'avocat", "avocats", "juriste"]},
    {"key": "office=notary", "label": "Notaire", "group": "Droit, Finance & Conseil", "synonyms": ["étude notariale"]},
    {"key": "office=accountant", "label": "Expert-comptable", "group": "Droit, Finance & Conseil", "synonyms": ["comptable", "comptabilité"]},
    {"key": "office=financial", "label": "Conseiller financier / Courtier", "group": "Droit, Finance & Conseil", "synonyms": ["courtier", "finance"]},
    {"key": "office=insurance", "label": "Assurance", "group": "Droit, Finance & Conseil", "synonyms": ["assureur"]},
    {"key": "office=consulting", "label": "Conseil / Consulting", "group": "Droit, Finance & Conseil", "synonyms": ["consultant"]},
    {"key": "office=tax_advisor", "label": "Conseiller fiscal", "group": "Droit, Finance & Conseil", "synonyms": []},
    {"key": "office=surveyor", "label": "Géomètre-expert", "group": "Droit, Finance & Conseil", "synonyms": ["géomètre"]},
    {"key": "office=employment_agency", "label": "Agence d'intérim / recrutement", "group": "Droit, Finance & Conseil", "synonyms": ["intérim", "recrutement", "ressources humaines"]},
    {"key": "office=association", "label": "Association", "group": "Droit, Finance & Conseil", "synonyms": []},
    {"key": "office=ngo", "label": "ONG", "group": "Droit, Finance & Conseil", "synonyms": ["association humanitaire"]},
    {"key": "amenity=bank", "label": "Banque / Agence bancaire", "group": "Droit, Finance & Conseil", "synonyms": ["banque"]},

    # --- Immobilier & Architecture ---
    {"key": "office=estate_agent", "label": "Agence immobilière", "group": "Immobilier & Architecture", "synonyms": ["immobilier"]},
    {"key": "office=architect", "label": "Architecte", "group": "Immobilier & Architecture", "synonyms": []},
    {"key": "craft=painter", "label": "Peintre en bâtiment", "group": "Immobilier & Architecture", "synonyms": ["peintre"]},

    # --- Communication, Audiovisuel & Médias ---
    {"key": "office=advertising_agency", "label": "Agence de communication", "group": "Communication & Médias", "synonyms": ["agence de pub", "publicité"]},
    {"key": "craft=photographer", "label": "Photographe", "group": "Communication & Médias", "synonyms": []},
    {"key": "shop=photo", "label": "Studio photo / Développement", "group": "Communication & Médias", "synonyms": ["labo photo"]},
    {"key": "office=newspaper", "label": "Presse / Rédaction", "group": "Communication & Médias", "synonyms": ["journal", "journaliste"]},
    {"key": "amenity=theatre", "label": "Théâtre", "group": "Communication & Médias", "synonyms": []},
    {"key": "amenity=cinema", "label": "Cinéma", "group": "Communication & Médias", "synonyms": []},
    {"key": "amenity=events_venue", "label": "Salle de spectacle / Événementiel", "group": "Communication & Médias", "synonyms": ["salle de concert", "événementiel"]},
    {"key": "amenity=arts_centre", "label": "Centre culturel", "group": "Communication & Médias", "synonyms": []},
    {"key": "tourism=museum", "label": "Musée", "group": "Communication & Médias", "synonyms": []},
    {"key": "tourism=gallery", "label": "Galerie d'art", "group": "Communication & Médias", "synonyms": []},

    # --- Santé ---
    {"key": "amenity=dentist", "label": "Dentiste", "group": "Santé", "synonyms": ["cabinet dentaire"]},
    {"key": "amenity=doctors", "label": "Médecin", "group": "Santé", "synonyms": ["cabinet médical", "docteur"]},
    {"key": "amenity=clinic", "label": "Clinique", "group": "Santé", "synonyms": []},
    {"key": "amenity=hospital", "label": "Hôpital", "group": "Santé", "synonyms": []},
    {"key": "amenity=pharmacy", "label": "Pharmacie", "group": "Santé", "synonyms": []},
    {"key": "amenity=veterinary", "label": "Vétérinaire", "group": "Santé", "synonyms": []},
    {"key": "healthcare=physiotherapist", "label": "Kinésithérapeute", "group": "Santé", "synonyms": ["kiné"]},
    {"key": "healthcare=psychotherapist", "label": "Psychothérapeute", "group": "Santé", "synonyms": ["psychologue"]},
    {"key": "healthcare=alternative", "label": "Médecine douce", "group": "Santé", "synonyms": ["ostéopathe", "naturopathe"]},
    {"key": "shop=optician", "label": "Opticien", "group": "Santé", "synonyms": []},
    {"key": "shop=hearing_aids", "label": "Audioprothésiste", "group": "Santé", "synonyms": []},

    # --- Artisanat & BTP ---
    {"key": "craft=electrician", "label": "Électricien", "group": "Artisanat & BTP", "synonyms": ["électricité"]},
    {"key": "craft=plumber", "label": "Plombier", "group": "Artisanat & BTP", "synonyms": ["plomberie"]},
    {"key": "craft=hvac", "label": "Chauffagiste / Climatisation", "group": "Artisanat & BTP", "synonyms": ["chauffage", "climatisation"]},
    {"key": "craft=carpenter", "label": "Charpentier / Menuisier", "group": "Artisanat & BTP", "synonyms": ["menuiserie", "charpente"]},
    {"key": "craft=roofer", "label": "Couvreur", "group": "Artisanat & BTP", "synonyms": ["toiture"]},
    {"key": "craft=mason", "label": "Maçon", "group": "Artisanat & BTP", "synonyms": ["maçonnerie"]},
    {"key": "craft=tiler", "label": "Carreleur", "group": "Artisanat & BTP", "synonyms": []},
    {"key": "craft=locksmith", "label": "Serrurier", "group": "Artisanat & BTP", "synonyms": ["serrurerie"]},
    {"key": "craft=gardener", "label": "Jardinier / Paysagiste", "group": "Artisanat & BTP", "synonyms": ["paysagisme", "espaces verts"]},
    {"key": "craft=glaziery", "label": "Vitrier", "group": "Artisanat & BTP", "synonyms": []},
    {"key": "craft=metal_construction", "label": "Métallier / Serrurerie métallique", "group": "Artisanat & BTP", "synonyms": []},

    # --- Automobile ---
    {"key": "shop=car", "label": "Concessionnaire automobile", "group": "Automobile", "synonyms": ["concession auto"]},
    {"key": "shop=car_repair", "label": "Garage / Mécanicien", "group": "Automobile", "synonyms": ["garagiste", "mécanique auto"]},
    {"key": "shop=car_parts", "label": "Pièces auto", "group": "Automobile", "synonyms": []},
    {"key": "shop=motorcycle", "label": "Concessionnaire moto", "group": "Automobile", "synonyms": []},
    {"key": "shop=tyres", "label": "Pneus", "group": "Automobile", "synonyms": ["pneumatiques"]},
    {"key": "amenity=fuel", "label": "Station-service", "group": "Automobile", "synonyms": ["essence"]},
    {"key": "amenity=car_wash", "label": "Lavage auto", "group": "Automobile", "synonyms": ["station de lavage"]},
    {"key": "amenity=driving_school", "label": "Auto-école", "group": "Automobile", "synonyms": []},

    # --- Commerces ---
    {"key": "shop=hairdresser", "label": "Coiffeur", "group": "Commerces", "synonyms": ["salon de coiffure", "coiffure"]},
    {"key": "shop=beauty", "label": "Institut de beauté", "group": "Commerces", "synonyms": ["esthéticienne"]},
    {"key": "shop=florist", "label": "Fleuriste", "group": "Commerces", "synonyms": []},
    {"key": "shop=bakery", "label": "Boulangerie", "group": "Commerces", "synonyms": []},
    {"key": "shop=butcher", "label": "Boucherie", "group": "Commerces", "synonyms": []},
    {"key": "shop=clothes", "label": "Vêtements", "group": "Commerces", "synonyms": ["prêt-à-porter"]},
    {"key": "shop=shoes", "label": "Chaussures", "group": "Commerces", "synonyms": []},
    {"key": "shop=jewelry", "label": "Bijouterie", "group": "Commerces", "synonyms": []},
    {"key": "shop=furniture", "label": "Meubles", "group": "Commerces", "synonyms": ["ameublement"]},
    {"key": "shop=electronics", "label": "Électronique", "group": "Commerces", "synonyms": []},
    {"key": "shop=mobile_phone", "label": "Téléphonie mobile", "group": "Commerces", "synonyms": []},
    {"key": "shop=books", "label": "Librairie", "group": "Commerces", "synonyms": []},
    {"key": "shop=supermarket", "label": "Supermarché", "group": "Commerces", "synonyms": []},
    {"key": "shop=bicycle", "label": "Vélo / Cycles", "group": "Commerces", "synonyms": []},
    {"key": "shop=travel_agency", "label": "Agence de voyage", "group": "Commerces", "synonyms": []},
    {"key": "shop=funeral_directors", "label": "Pompes funèbres", "group": "Commerces", "synonyms": []},
    {"key": "shop=laundry", "label": "Laverie", "group": "Commerces", "synonyms": []},
    {"key": "shop=dry_cleaning", "label": "Pressing", "group": "Commerces", "synonyms": []},

    # --- Sport & Loisirs ---
    {"key": "leisure=fitness_centre", "label": "Salle de sport", "group": "Sport & Loisirs", "synonyms": ["fitness", "musculation"]},
    {"key": "leisure=sports_centre", "label": "Centre sportif", "group": "Sport & Loisirs", "synonyms": []},
    {"key": "leisure=swimming_pool", "label": "Piscine", "group": "Sport & Loisirs", "synonyms": []},
    {"key": "leisure=golf_course", "label": "Golf", "group": "Sport & Loisirs", "synonyms": []},

    # --- Administration & Éducation ---
    {"key": "amenity=post_office", "label": "Bureau de poste", "group": "Administration & Éducation", "synonyms": []},
    {"key": "amenity=school", "label": "École", "group": "Administration & Éducation", "synonyms": []},
    {"key": "amenity=college", "label": "Collège / Lycée", "group": "Administration & Éducation", "synonyms": []},
    {"key": "amenity=university", "label": "Université", "group": "Administration & Éducation", "synonyms": []},
]

# Sécurité : on garantit l'unicité des clés (utile si le fichier est
# étendu à la main plus tard sans y prêter attention).
_seen_keys = set()
for _entry in CATEGORY_CATALOG:
    assert _entry["key"] not in _seen_keys, f"Clé de catégorie dupliquée : {_entry['key']}"
    _seen_keys.add(_entry["key"])
