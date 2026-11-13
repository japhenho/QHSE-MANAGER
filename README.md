# QHSE MANAGER

Plateforme QHSE intégrée pour les entreprises industrielles onshore et offshore.

> **État : fondations techniques (Phase 0).** Aucun module métier, aucune authentification. Ce dépôt n'est ni prêt pour la production, ni audité en sécurité. Voir `docs/PROGRESS.md`.

## Prérequis

- Node.js 22 (voir `.nvmrc`) et pnpm 10
- PostgreSQL 16 (via Docker Compose ou installé localement)

## Démarrage

```bash
pnpm install
cp .env.example .env        # puis adapter les valeurs ; ne jamais commiter .env
pnpm db:up                  # PostgreSQL ; crée les deux rôles et les bases qhse_dev et qhse_test
pnpm build
pnpm db:migrate             # applique les migrations avec le rôle propriétaire
pnpm dev:api                # http://localhost:3000/api/v1/health/ready — docs : /api/docs
pnpm dev:web                # http://localhost:5173
```

Un seul fichier `.env` à la racine sert à l'API et au web (variables `VITE_*`).

### Base de données : deux rôles

| Rôle                        | Variable                 | Usage                                                                                |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------ |
| Propriétaire (`qhse_owner`) | `MIGRATION_DATABASE_URL` | Possède le schéma, exécute les migrations. Jamais utilisé par l'API.                 |
| Exécution (`qhse_app`)      | `DATABASE_URL`           | Utilisé par l'API. Ni superutilisateur, ni propriétaire, sans `BYPASSRLS`, sans DDL. |

Cette séparation est ce qui permet au cloisonnement par ligne (RLS) de s'appliquer réellement à l'API (ADR 0002).

Sans Docker, ou sur un serveur PostgreSQL existant, créer les rôles et les bases avec un superutilisateur :

```bash
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=... DB_OWNER_PASSWORD=... DB_APP_PASSWORD=... pnpm db:init
```

Le script est rejouable. `pnpm --filter @qhse/api prisma:migrate` crée une nouvelle migration en développement.

## Contrôles

```bash
pnpm lint
pnpm typecheck
pnpm test          # tests unitaires, sans base de données
pnpm format:check
```

### Tests d'intégration

```bash
pnpm test:e2e
```

Ils lisent `TEST_DATABASE_URL` (rôle d'exécution) et `TEST_MIGRATION_DATABASE_URL` (rôle propriétaire), appliquent les migrations, puis lancent l'API réelle contre PostgreSQL. La base visée doit avoir un nom finissant par `_test` : elle est vidée par les tests. Si la base est injoignable, la commande échoue ; aucun test n'est ignoré.

## Structure

| Dossier           | Contenu                                                     |
| ----------------- | ----------------------------------------------------------- |
| `apps/api`        | API NestJS + Prisma + PostgreSQL                            |
| `apps/web`        | Application web React + Vite + Tailwind                     |
| `packages/shared` | Types, schémas et constantes partagés                       |
| `docs`            | Avancement, backlog, décisions ouvertes, ADR, prompt maître |

## Documentation

- `AGENTS.md` — règles condensées et commandes
- `docs/PROGRESS.md` — état d'avancement
- `docs/BACKLOG.md` — lots et critères d'acceptation
- `docs/DECISIONS-OUVERTES.md` — décisions en attente
- `docs/adr/` — décisions d'architecture
