# ADR 0001 — Structure du dépôt : monorepo pnpm et monolithe modulaire

- **Statut :** Accepté (2026-11-13) — conforme à la stack cible du prompt maître (section 3) ; reflète le socle créé en Phase 0.
- **Décideurs :** Tech Lead. À rediscuter uniquement sur fait nouveau.

## Contexte

Le dépôt était vide au début de la Phase 0. Le produit doit livrer une API, une application web, plus tard une application mobile, et partager entre elles des types, des schémas de validation et des constantes métier. Le même code doit tourner en SaaS multi-tenant et en installation privée, sur des serveurs parfois modestes exploités par de petites équipes.

## Décision

1. **Monorepo pnpm workspaces** (`pnpm-workspace.yaml` : `apps/*`, `packages/*`), un seul lockfile, Node ≥ 22 (`.nvmrc` : 22).
   - `apps/api` (`@qhse/api`) — NestJS, Prisma, PostgreSQL.
   - `apps/web` (`@qhse/web`) — React, Vite, Tailwind CSS, TanStack Query, i18next.
   - `apps/mobile` — **non créé** ; il le sera à l'ouverture de la Phase 5 seulement.
   - `packages/shared` (`@qhse/shared`) — types, schémas de validation (zod) et constantes partagés. Il contient aujourd'hui les utilitaires de pagination, l'enveloppe d'erreur et la liste des langues.
2. **Scripts racine uniformes** : `build`, `lint`, `typecheck`, `test` délèguent à chaque paquet par `pnpm -r run …`. Chaque paquet doit donc exposer ces quatre scripts.
3. **Configuration commune** à la racine : `tsconfig.base.json` (mode strict, `noUncheckedIndexedAccess`, `noImplicitOverride`), `eslint.config.mjs` (configuration « flat », `no-explicit-any` en erreur), Prettier.
4. **TypeScript épinglé sur la série 6.x.** TypeScript 7 ne fournit pas l'API de compilation dont dépendent `typescript-eslint`, `ts-jest` et `tsup`, utilisés par ce dépôt. Le passage à la série 7 se fera par un ADR dédié, quand ces trois outils la prendront en charge et après vérification de la chaîne complète (lint, tests, build).
5. **Backend en monolithe modulaire** : un module NestJS par domaine métier (`auth`, `tenancy`, `audit`, `incidents`, …). Règles de dépendance :
   - un module n'accède aux données d'un autre domaine que par le service public exporté par ce dernier, jamais par ses tables ;
   - les mécanismes transverses (contexte tenant, audit, machine à états, numérotation, idempotence) vivent dans des modules techniques dédiés, utilisés par tous ;
   - `packages/shared` ne dépend ni de NestJS ni de React.
6. **Aucun orchestrateur de build supplémentaire** (Turborepo, Nx) pour l'instant : trois paquets ne le justifient pas.

## Alternatives envisagées

| Alternative                   | Raison du rejet                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un dépôt par application      | Partage des schémas de validation par publication de paquets : lourd, source de désynchronisation entre API et clients.                                     |
| Microservices                 | Exclus par le prompt maître. Coût d'exploitation incompatible avec l'on-premise sur un seul serveur ; transactions réparties pour l'audit et les workflows. |
| npm ou Yarn workspaces        | Fonctionnellement possibles ; pnpm retenu pour son isolation stricte des dépendances (un paquet ne peut pas importer une dépendance qu'il ne déclare pas).  |
| Turborepo / Nx dès maintenant | Dépendance et configuration supplémentaires sans gain mesurable à cette taille. À réévaluer si les temps de CI deviennent gênants.                          |
| TypeScript 7 dès maintenant   | Chaîne d'outils (lint, tests, build du paquet partagé) non compatible à ce jour.                                                                            |

## Conséquences

- **Positif :** un changement de contrat (schéma zod, code d'erreur) se propage à l'API et au web dans le même commit ; une seule CI ; un seul lockfile fige les versions pour la distribution on-premise.
- **Négatif / à surveiller :**
  - `@qhse/shared` est consommé via son dossier `dist` : il doit être construit avant le typecheck, les tests ou le démarrage des applications qui l'importent. L'ordre est géré par `pnpm -r` (ordre topologique), mais lancer une application seule suppose que `shared` a été construit.
  - `pnpm -r run test` échoue si un paquet n'a pas de script `test` : tout nouveau paquet doit fournir les quatre scripts.
  - **Schéma Prisma réparti (vérifié au lot P1-01, Prisma 7.10) :** le schéma est un dossier, `apps/api/prisma/schema/`, avec un fichier par domaine ; `prisma validate` et `prisma generate` ont été exécutés avec deux fichiers. Deux lots parallèles ne se disputent donc plus le même fichier de schéma. Le dossier des migrations reste en revanche une séquence unique : les migrations de lots parallèles sont intégrées une par une, chacune rejouée sur base vierge.
  - L'épinglage de TypeScript devra être levé un jour : dette connue, suivie par cet ADR.
- **Sans effet sur :** le mode de déploiement (une image API, des fichiers statiques web), décrit ultérieurement.
