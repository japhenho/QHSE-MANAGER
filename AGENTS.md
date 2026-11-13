# AGENTS.md — QHSE MANAGER

Fichier mémoire lu au début de chaque session. Court par nature : le détail est dans les documents cités.

## Le projet

Plateforme QHSE intégrée (qualité, santé, sécurité, environnement) pour entreprises industrielles onshore/offshore d'Afrique centrale. Une seule base de code pour le SaaS multi-tenant et l'installation privée. Web + mobile, FR/EN, utilisable avec une connectivité faible.

## Sources de vérité

| Document                                     | Rôle                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------- |
| `docs/prompts/PROMPT_MAITRE_QHSE_MANAGER.md` | Spécification maîtresse : règles, boucle de travail, phases.          |
| `docs/PROGRESS.md`                           | État courant, lot en cours, prochain lot, points bloquants.           |
| `docs/BACKLOG.md`                            | Lots priorisés, dépendances, critères d'acceptation, parallélisation. |
| `docs/DECISIONS-OUVERTES.md`                 | Questions en attente d'une réponse humaine (D-01…).                   |
| `docs/adr/`                                  | Décisions techniques.                                                 |

Début de session : lire `docs/PROGRESS.md`, vérifier `git status`, reprendre le lot indiqué. Ne pas refaire l'audit.

## Ordre de priorité

Sécurité et isolation des données > exactitude métier et traçabilité > non-régression > maintenabilité > périmètre > vitesse.

## Règles non négociables (résumé)

- Toute donnée métier porte un `tenant_id` ; le tenant vient de la session authentifiée, jamais du client. Accès inter-tenant = 404.
- Chaque endpoint livré a un test d'isolation tenant et un test de permission. Refus par défaut.
- Workflows = machines à états côté serveur ; chaque transition est tracée (acteur, date serveur, avant, après, motif) dans un journal d'audit en ajout seul.
- Clés primaires UUID ; numéros métier attribués par le serveur ; archivage logique.
- Aucun texte d'interface en dur : fichiers i18n FR et EN. Code et commits en anglais, documentation en français.
- Aucun secret ni donnée réelle dans le code, les logs, les fixtures. Pas de faux chiffres en production.
- Pas de `any`. Validation serveur de toutes les entrées (schémas zod, partagés dans `packages/shared` quand le web en a besoin).
- Erreurs : enveloppe unique `ApiError` (`packages/shared/src/errors.ts`).
- Ne jamais affaiblir ou ignorer un test pour obtenir du vert. Ne jamais déclarer réussi un test non exécuté.
- Ne développer un module que lorsque sa phase est ouverte. Pas de tables ni d'écrans « pour plus tard ».
- Git : commits atomiques (Conventional Commits) sur la branche de développement ; pas de PR sans demande.

## Dépôt

```
apps/api        NestJS 12 (ESM natif) + Prisma 7 + PostgreSQL — routes sous /api/v1
apps/web        React 19 + Vite 8 + Tailwind 4 + TanStack Query + i18next
packages/shared Types, schémas zod et constantes partagés (construit en CJS + ESM)
docs/           Documentation projet, ADR, prompt maître
```

`apps/mobile` n'existe pas avant la Phase 5.

## Pièges connus

- **TypeScript est figé en 6.x.** TS 7 n'expose pas l'API de compilation dont dépendent typescript-eslint, ts-jest et tsup. Ne pas mettre à jour.
- **L'API est en ESM natif** : imports relatifs avec extension `.js`, `import.meta.dirname` au lieu de `__dirname`, Jest lancé avec `--experimental-vm-modules`, `jest` importé depuis `@jest/globals`.
- **Prisma 7** : configuration dans `apps/api/prisma.config.ts`, client généré dans `apps/api/src/generated/prisma` (ignoré par Git), adaptateur `@prisma/adapter-pg`. Le `.env` n'est pas chargé automatiquement par Prisma.
- `packages/shared` doit être construit avant lint/typecheck/tests des applications (les scripts racine le font).
- Tailwind 4 se configure en CSS (`apps/web/src/styles/index.css`), pas dans un `tailwind.config.js`.
- Versions de bibliothèques très récentes : vérifier la documentation actuelle avant d'utiliser une API de mémoire.

## Commandes (racine)

| Commande                                     | Effet                                                                |
| -------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm install`                               | Installe les dépendances.                                            |
| `pnpm build`                                 | Construit shared, API et web.                                        |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Contrôles sur tout le dépôt (tests unitaires, sans base de données). |
| `pnpm test:e2e`                              | Tests e2e de l'API ; nécessite `DATABASE_URL` joignable.             |
| `pnpm format` / `pnpm format:check`          | Prettier.                                                            |
| `pnpm db:up` / `pnpm db:down`                | PostgreSQL de développement (Docker Compose).                        |
| `pnpm dev:api` / `pnpm dev:web`              | Serveurs de développement (API : 3000, web : 5173).                  |
| `pnpm --filter @qhse/api prisma:migrate`     | Crée/applique les migrations en développement.                       |
| `pnpm --filter @qhse/api prisma:deploy`      | Applique les migrations (CI, production).                            |
