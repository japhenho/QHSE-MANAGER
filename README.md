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
pnpm db:up                  # PostgreSQL de développement
pnpm build
pnpm --filter @qhse/api prisma:migrate
pnpm dev:api                # http://localhost:3000/api/v1/health/ready — docs : /api/docs
pnpm dev:web                # http://localhost:5173
```

Un seul fichier `.env` à la racine sert à l'API et au web (variables `VITE_*`).

## Contrôles

```bash
pnpm lint
pnpm typecheck
pnpm test          # tests unitaires, sans base de données
pnpm test:e2e      # tests e2e de l'API, DATABASE_URL requis
pnpm format:check
```

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
