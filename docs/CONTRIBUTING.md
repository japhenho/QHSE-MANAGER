# Guide de contribution — QHSE MANAGER

Les règles générales sont dans `AGENTS.md` et dans le prompt maître. Ce guide décrit les gestes récurrents.

## Avant de commiter

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e      # nécessite PostgreSQL et les variables TEST_* (voir README)
```

Commits au format Conventional Commits, en anglais. Un lot ne se termine que si tous ces contrôles passent.

## Ajouter un endpoint

1. **Schémas d'entrée** dans `packages/shared` (zod), utilisés par l'API (`ZodValidationPipe`) et par le web.
2. **Permission** : `@RequirePermission(PERMISSIONS.X)` sur la route. Sans déclaration, la route répond `403`.
3. **Accès aux données** : uniquement `TenantDatabase.run(...)`. Le tenant vient de la session ; ne jamais le lire dans la requête.
4. **Audit** : toute action sensible appelle `AuditService.record(tx, …)` dans la même unité de travail.
5. **Tests obligatoires** (critères CC-1 et CC-2), avec le harnais ci-dessous.

## Harnais de tests d'un endpoint

Fichiers : `apps/api/test/support/auth.ts` et `apps/api/test/support/endpoint-contract.ts`.

Préparer les acteurs :

```ts
const adminA = await seedAccount(owner, 'mon-module-alpha', { administrator: true });
const sansRole = await addUser(owner, adminA, 'nobody'); // connecté, aucun droit
const lecteur = await addUser(owner, adminA, 'reader', { permissions: [PERMISSIONS.X_READ] });
const adminB = await seedAccount(owner, 'mon-module-bravo', { administrator: true });
const jeton = (await openSession(app, adminA)).accessToken;
```

Puis, pour **chaque** endpoint :

```ts
// CC-2 : 401 sans jeton, 403 sans la permission
await expectPermissionRequired(app, { method: 'get', url: `/api/v1/choses/${id}` }, jetonSansRole);

// CC-1, ressource unique : pour un autre tenant, même réponse que pour un identifiant inexistant
await expectInvisibleAcrossTenants(
  app,
  { method: 'get', url: `/api/v1/choses/${idDeA}` },
  `/api/v1/choses/${uuidv7()}`,
  jetonAdminB,
);

// CC-1, liste : aucun identifiant de A, et un total qui ne les compte pas
await expectListExcludes(app, '/api/v1/choses', jetonAdminB, [idDeA]);
```

Le test générique de `rbac.e2e-spec.ts` (« deny by default ») parcourt toutes les routes : une route ajoutée sans permission le fait échouer. Une route publique ou ouverte à tout utilisateur connecté doit être ajoutée explicitement à sa liste, ce qui en fait une décision visible en revue.

Pour simuler le temps (expiration, verrouillage) : `FakeClock`, passé à `createTestApp({}, { clock })`.

## Ajouter une table

1. Modèle dans `apps/api/prisma/schema/<domaine>.prisma`, avec `tenantId`, les contraintes d'unicité incluant `tenantId` et les clés étrangères composites `(tenantId, …)`.
2. `pnpm --filter @qhse/api prisma:migrate -- --create-only --name <nom>`, puis ajouter à la main dans la migration : `ENABLE` et `FORCE ROW LEVEL SECURITY`, et la politique `tenant_isolation`. Le test de catalogue échoue sinon.
3. Déclarer le modèle dans `TENANT_SCOPE` (`apps/api/src/tenancy/tenant-scope.ts`) — la compilation échoue sinon.

## Ajouter un écran web

1. Route dans `apps/web/src/app/routes.tsx`, sous `RequirePermission` si elle demande un droit.
2. Entrée de menu dans `NAV_ITEMS` (`navigation.ts`) avec sa `permission`.
3. Textes dans `i18n/locales/fr.ts` **et** `en.ts` ; aucun texte en dur.
4. États de chargement, d'erreur et vide (composant `ListStates` pour les listes).
5. Formulaire : validation avec le schéma partagé avant l'appel, envoi de la `version` lue, et `useUnsavedChangesWarning(dirty)` pour avertir avant une perte de saisie (appeler `allowNextNavigation()` juste avant la redirection qui suit un enregistrement réussi).
6. Tests avec `renderApp(chemin, { status: 'authenticated', identity: identityWith([...]) })`.
