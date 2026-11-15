# ADR 0007 — Périmètres d'accès : un rôle s'attribue sur une entreprise, un site ou un département

- **Statut :** Accepté — mis en œuvre et vérifié par le lot **P1-07**.
- **Date :** 2026-11-15.
- **Références :** prompt maître, section 4.3 ; ADR 0002 ; `docs/ROLES-PERMISSIONS.md`.

## Contexte

Le prompt maître exige des restrictions d'accès par entreprise, site, département, projet et contrat. Jusqu'au lot P1-05, un rôle valait pour tout le tenant. Il faut qu'un chef de site ne voie et ne modifie que son site, sans multiplier les rôles ni écrire un filtre à la main dans chaque requête.

## Décision

### 1. Le périmètre est porté par l'attribution, pas par le rôle

Un même rôle (« Chef de site ») s'attribue à plusieurs personnes sur des périmètres différents. Une attribution = un utilisateur, un rôle, un périmètre : `tenant`, `company`, `site` ou `department`. Plusieurs attributions se cumulent (**union**).

En base, `role_assignments` porte `scope_type` et une colonne par type (`company_id`, `site_id`, `department_id`) avec clé étrangère composite `(tenant_id, …)` : un périmètre appartient forcément au tenant de l'attribution. Une contrainte garantit qu'exactement la bonne colonne est renseignée. Ajouter `project` ou `contract` plus tard = une valeur d'énumération et une colonne, avec le premier module qui en a besoin.

### 2. Un périmètre couvre ce qu'il contient, jamais ce qui le contient

- tenant → tout ;
- entreprise → ses sites et leurs départements ;
- site → ses départements ;
- département → lui seul.

Un chef de site ne voit donc pas la fiche de son entreprise (seulement son nom sur la fiche du site).

### 3. Un seul endroit décide : `AccessScope`

`apps/api/src/rbac/access-scope.ts` calcule, pour chaque permission d'un utilisateur, où elle s'applique, et fournit à la fois le **filtre de base de données** (listes) et le **contrôle sur une fiche**. Les droits sont recalculés à chaque requête.

### 4. Tenant entier par défaut ; le périmètre est un choix explicite par route

`@RequirePermission(P)` exige la permission **pour tout le tenant**. Une route n'accepte une permission détenue sur un périmètre plus étroit que si elle le déclare (`{ scoped: true }`) ; son traitement doit alors filtrer avec `actor.scopeOf(P)`. Ainsi, oublier le filtre est impossible sur une route non déclarée, et les ressources sans localisation (rôles, utilisateurs, journal d'audit) restent réservées aux droits sur tout le tenant.

### 5. Hors périmètre = inexistant

Une fiche hors du périmètre de l'appelant répond `404`, exactement comme un identifiant inconnu ; elle est absente des listes et des totaux. Seule exception : créer une entreprise sans droit sur tout le tenant répond `403` (il n'y a pas de fiche à cacher).

### 6. Lecture et gestion ont chacune leur périmètre

`organization:read` et `organization:manage` sont évaluées séparément : on peut lire une entreprise entière et ne gérer qu'un site.

### 7. Attribution des rôles

Avec `role:assign` sur un périmètre, on attribue et on retire des rôles **dans ce périmètre seulement**, et seulement des rôles dont on y détient toutes les permissions. Le rôle Administrateur attribué sur un site fait un administrateur de ce site, pas du tenant ; la règle du « dernier administrateur » ne compte que les administrateurs du tenant entier.

## Alternatives envisagées

| Alternative                                             | Raison du rejet                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Périmètre porté par le rôle (« Chef du site de Djeno ») | Un rôle par site et par poste : explosion du nombre de rôles.                                                                   |
| Périmètre implicite sur toutes les routes               | Un oubli de filtre dans un traitement donnerait un accès trop large sans que rien ne le signale.                                |
| Filtrage par périmètre dans la base (RLS)               | Les politiques deviendraient dépendantes de chaque table et de l'utilisateur ; la RLS reste dédiée à l'isolation entre tenants. |
| Réponse `403` hors périmètre                            | Révélerait l'existence de fiches d'autres sites.                                                                                |
| Visibilité des ascendants                               | Plus confortable, mais contraire au moindre privilège ; le nom du parent suffit.                                                |

## Conséquences

- **Positif :** un poste = un rôle, quel que soit le nombre de sites ; les modules métier réutilisent `AccessScope` et le harnais de tests de périmètre.
- **Limites assumées :**
  - Le périmètre est une barrière **applicative** (la RLS ne sépare que les tenants) : chaque route « scoped » doit avoir ses tests de périmètre.
  - Les utilisateurs ne sont pas encore rattachés à un site : la liste des utilisateurs demande `user:read` sur tout le tenant, y compris pour un chef de site qui attribue des rôles.
  - Les listes de choix du web chargent au plus 100 entreprises, sites ou départements.
  - Un périmètre archivé conserve ses attributions.
