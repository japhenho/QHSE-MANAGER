# État d'avancement — QHSE MANAGER

Mis à jour à chaque itération. Dernière mise à jour : 2026-11-13.

## Phase en cours

**Phase 1 — Fondations.** Lots P1-01, P1-02 et P1-03 livrés.

## Livré et vérifié

- Dépôt initialement vide → monorepo pnpm (`apps/api`, `apps/web`, `packages/shared`), TypeScript strict, ESLint, Prettier, CI GitHub Actions, Docker Compose (PostgreSQL), `.env.example`.
- `packages/shared` : enveloppe d'erreur et codes stables, schéma de pagination avec limite serveur, locales.
- `apps/api` : préfixe `/api/v1`, configuration validée au démarrage, helmet, CORS par liste blanche, logs JSON avec identifiant de requête et masquage des en-têtes sensibles, filtre d'erreurs global, pipe de validation zod, Prisma (aucun modèle), `health/live` et `health/ready`, OpenAPI sur `/api/docs`.
- `apps/web` : shell responsive (barre latérale, tiroir mobile), navigation pilotée par une configuration typée, jetons de design, primitives UI, i18n FR/EN, couche d'appel API typée, page « État du système ».
- Direction visuelle « Salle de contrôle » (modèle A) appliquée au socle web : jetons sombres, polices embarquées, test de contraste (ADR 0006).
- **P1-01** : deux rôles PostgreSQL (propriétaire pour les migrations, exécution pour l'API, sans DDL ni contournement de la RLS), script d'initialisation rejouable `infra/postgres/db-init.sh`, harnais de tests d'intégration (base `*_test`, migrations appliquées, échec franc si la base est injoignable), schéma Prisma réparti par domaine.
- **P1-02** : tables `tenants` et `users` (minimale), RLS activée et forcée, contexte tenant (`runInTenantContext`), point d'accès unique aux données `TenantDatabase.run`, UUID v7, commande `tenant:create`, test de catalogue et test d'architecture. D-02 tranchée (base partagée), ADR 0002 accepté.
- **P1-03** : journal d'audit `audit_events` en ajout seul (privilèges + déclencheurs), heure fixée par la base, écriture dans la transaction métier via `AuditService.record`, isolation par tenant. ADR 0005 accepté ; partitionnement vérifié faisable et reporté.
- Cadrage : `docs/BACKLOG.md` (Phases 1 et 2 détaillées), `docs/DECISIONS-OUVERTES.md` (D-01 à D-13), ADR 0001 à 0006, maquettes dans `docs/maquettes/`.

Preuves du 2026-11-13 (commandes lancées à la racine) :

| Commande                                            | Résultat                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm build`                                        | OK                                                                                      |
| `pnpm lint`                                         | OK                                                                                      |
| `pnpm typecheck`                                    | OK                                                                                      |
| `pnpm test`                                         | OK — shared 4, API 148, web 70                                                          |
| `pnpm test:e2e` (PostgreSQL 16 local)               | OK — 99 (santé 12, rôles 15, RLS 26, chemin applicatif et provisionnement 24, audit 22) |
| `pnpm format:check`                                 | OK                                                                                      |
| Parcours réel dans un navigateur (web → API → base) | OK en 1280 px et 390 px, aucune erreur console                                          |

## Non vérifié

- **CI GitHub Actions** : le workflow est écrit mais n'a jamais tourné (il se déclenche sur `main` et sur les pull requests).
- **`docker compose`** : le fichier n'a pas été exécuté (pas de démon Docker dans l'environnement de travail) ; les tests ont utilisé un PostgreSQL 16 local.
- Swagger UI n'a été vérifié que par son code HTTP 200, pas à l'écran.

## Écarts connus

- `docs/ROLES-PERMISSIONS.md` et `docs/KPI.md` ne sont pas encore écrits : ils dépendent de D-05 et D-11 et seront produits dans les lots P1-05 et P2-13.
- P1-10 (i18n) et P1-11 (design system) sont partiellement couverts par le socle web ; leur reste à faire est décrit dans le backlog.
- Les ADR 0002 et 0003 sont au statut « Proposé ».

## Bloquant

Validation du cadrage, et en priorité les décisions à trancher **avant la Phase 1** : **D-02** (modèle d'isolation), **D-12** (identification du tenant à la connexion), **D-13** (provisionnement des tenants).

## Prochain lot

**P1-04 — Authentification** : **bloqué par D-12** (identification du tenant à la connexion). Sans cette décision, seul P1-11 (design system, web seul) peut avancer.
