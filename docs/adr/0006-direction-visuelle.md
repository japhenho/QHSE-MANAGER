# ADR 0006 — Direction visuelle : « Salle de contrôle »

## Statut

Accepté — choisi par le porteur du projet le 2026-11-13 parmi trois maquettes (`docs/maquettes/modeles-frontend.html`, modèle A).

## Contexte

Trois directions ont été proposées : A « Salle de contrôle » (sombre, centrée sur la vue du site), B « Registre » (claire, type suite de gestion), C « Terrain » (fort contraste, gros boutons). Une seule direction doit s'appliquer à tous les modules.

## Décision

- Thème sombre unique, défini par les jetons de `apps/web/src/styles/index.css`. Les composants n'utilisent que ces jetons sémantiques.
- Typographies : Barlow (texte), Barlow Condensed (titres), IBM Plex Mono (références et chiffres). Elles sont **embarquées dans l'application** (paquets `@fontsource`), sans appel à un service externe, pour fonctionner en installation privée et en connectivité faible.
- Les contrastes sont garantis par un test (`apps/web/src/styles/tokens.test.ts`) : texte ≥ 7:1, indicateurs ≥ 3:1.
- La vue 3D du site (maquette avec repères de permis, incidents, personnel) est l'écran d'accueil cible. Elle sera construite quand les données de sites existeront (après P1-06), avec une alternative en liste accessible ; elle n'est pas livrée par ce lot.

## Alternatives envisagées

- **B « Registre »** : plus classique et plus lisible sur papier ou en plein soleil ; écarté par choix du porteur du projet.
- **C « Terrain »** : reste la référence pour l'application mobile (Phase 5), à réévaluer à ce moment-là.
- **Thème clair en option** : non retenu pour l'instant ; les jetons permettent de l'ajouter sans toucher aux composants.

## Conséquences

- Lisibilité d'un thème sombre en extérieur à valider sur le terrain avec des utilisateurs ; un thème clair pourra être nécessaire pour les écrans mobiles.
- Les exports et impressions (PDF) auront leur propre feuille de style claire.
- Les polices ajoutent environ 160 ko de fichiers woff2 chargés à la demande et mis en cache.
