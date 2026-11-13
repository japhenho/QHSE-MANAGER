# ADR 0002 — Stratégie multi-tenant : `tenant_id`, filtrage applicatif centralisé et Row-Level Security

- **Statut :** Proposé (2026-11-13) — en attente de la décision **D-02** (modèle d'isolation) et, pour la table des utilisateurs, de **D-12**. Le mécanisme décrit doit en outre être confirmé par le spike du lot **P1-02** avant de passer à « Accepté ».
- **Références :** prompt maître, section 4.3 ; `docs/DECISIONS-OUVERTES.md` (D-02, D-12, D-13).

## Contexte

Le même code sert un SaaS multi-entreprises et des installations privées. Une fuite de données entre deux clients est le risque le plus grave du produit (ordre de priorité du prompt maître : sécurité et isolation en premier). Le prompt maître impose une isolation en deux couches et interdit d'écrire le filtre `tenant_id` à la main dans chaque requête. La stack est NestJS + Prisma 7 (avec l'adaptateur de pilote `@prisma/adapter-pg`) + PostgreSQL 16.

## Décision

### 1. Modèle de données

- Base partagée. Toute table métier porte une colonne `tenant_id uuid NOT NULL` référençant `tenants(id)`.
- La table `tenants` elle-même n'est pas filtrée par tenant ; elle n'est accessible qu'au code de résolution du tenant et à la commande de provisionnement (D-13).
- Toute contrainte d'unicité métier inclut `tenant_id` (ex. `UNIQUE (tenant_id, email)`, `UNIQUE (tenant_id, number)`).
- Les clés étrangères entre tables métier sont **composites** `(tenant_id, <id>)` vers une contrainte `UNIQUE (tenant_id, id)` de la table cible, afin que la base refuse une référence vers une ligne d'un autre tenant. Motif : les vérifications de clés étrangères de PostgreSQL ne passent pas par les politiques RLS. La faisabilité avec le schéma Prisma (relations sur clés composites) est à confirmer dans le spike P1-02 ; à défaut, la contrainte est ajoutée en SQL dans la migration.
- Un index commence par `tenant_id` sur toute table listée ou filtrée.

### 2. Origine du tenant

- Le tenant et l'utilisateur sont lus dans la **session authentifiée** (ADR 0003), jamais dans un paramètre, un en-tête ou un corps de requête.
- Ils sont placés dans un contexte de requête (`AsyncLocalStorage`) par un garde global. Tout accès aux données hors contexte tenant **échoue** (erreur, pas « toutes les lignes »).
- Seule exception : avant authentification, l'identifiant de tenant saisi à la connexion sert à _identifier_ le compte (D-12) ; il n'accorde aucun accès.

### 3. Couche 1 — filtrage applicatif centralisé

- Un seul point d'accès aux données tenant : un client Prisma « à portée tenant » fourni par le module `tenancy`. Les modules métier n'instancient ni n'injectent jamais le client Prisma brut.
- Ce client ajoute `tenant_id` aux filtres de lecture, de mise à jour et de suppression logique, et l'impose à la création, quelle que soit la valeur présente dans la requête.
- Une règle de lint (ou un test d'architecture) interdit l'import du client brut en dehors du module `tenancy` et des scripts de migration.
- Mise en œuvre envisagée : extension de client Prisma (`$extends`). **À vérifier par le spike P1-02** : couverture de toutes les opérations (dont `findUnique`, `upsert`, écritures imbriquées, `$queryRaw`) avec la version installée. Les requêtes SQL brutes ne sont pas filtrées par une extension : elles sont interdites dans les modules métier, sauf revue explicite, et restent couvertes par la couche 2.

### 4. Couche 2 — Row-Level Security PostgreSQL

- Sur chaque table métier : `ENABLE ROW LEVEL SECURITY` **et** `FORCE ROW LEVEL SECURITY`, avec une politique de la forme :

  ```sql
  CREATE POLICY tenant_isolation ON incidents
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  ```

  Si le paramètre est absent ou vide, la comparaison vaut `NULL` : aucune ligne n'est visible ni insérable (échec fermé).

- **Deux rôles PostgreSQL distincts :**
  - un rôle propriétaire du schéma, utilisé uniquement pour les migrations ;
  - un rôle d'exécution pour l'API : ni superutilisateur, ni propriétaire des tables, sans attribut `BYPASSRLS`. Sans cela, la RLS ne s'applique pas (un superutilisateur ou un rôle `BYPASSRLS` y échappe toujours ; le propriétaire y échappe sans `FORCE`).
  - Le `docker-compose.yml` de développement ne crée aujourd'hui qu'un seul utilisateur (`qhse`), qui est superutilisateur : la création du second rôle fait partie du lot P1-01. **Tant qu'elle n'est pas faite, la RLS serait inopérante.**
- Un test automatique parcourt le catalogue PostgreSQL et échoue si une table possédant une colonne `tenant_id` n'a pas la RLS activée et forcée avec la politique attendue : une nouvelle table ne peut pas être oubliée.

### 5. Passage du tenant à la session PostgreSQL — implication avec Prisma et le pool de connexions

- Le tenant est transmis par `SELECT set_config('app.tenant_id', $1, true)` exécuté **au début d'une transaction** ; le troisième argument `true` limite la valeur à cette transaction.
- **Jamais de `SET` au niveau de la session** : les connexions sont partagées par un pool ; une valeur de session survivrait à la requête et serait héritée par la requête suivante d'un autre tenant. La portée transaction est aussi la seule compatible avec un pooler externe en mode transaction (PgBouncer).
- Conséquence pratique : **toute requête sur une table métier s'exécute dans une transaction qui a d'abord positionné le tenant**. Deux mises en œuvre sont possibles et seront départagées par le spike P1-02 :
  1. _Transaction par requête HTTP_ : un intercepteur ouvre une transaction interactive Prisma, positionne le tenant et expose le client transactionnel via le contexte. Simple à raisonner, écritures atomiques par défaut ; mais une connexion du pool est retenue pendant toute la requête (dimensionnement du pool, délai maximal des transactions interactives de Prisma à configurer, aucun appel réseau lent à l'intérieur).
  2. _Transaction par opération_ : une extension de client enveloppe chaque opération dans une transaction courte `[set_config, opération]`. Connexions libérées plus vite ; mais deux allers-retours par opération et une composition délicate avec les transactions métier explicites.
- **Points à prouver par le spike** (ne pas les tenir pour acquis) : comportement avec `@prisma/adapter-pg` et le pool `pg` ; absence de fuite du paramètre entre deux transactions consécutives sur la même connexion ; comportement sous requêtes concurrentes de tenants différents ; coût mesuré de chaque variante ; comportement des traitements hors requête HTTP (scripts, futurs jobs), qui doivent eux aussi établir un contexte tenant explicite.

### 6. Réponse aux accès inter-tenant

- Lecture, modification ou suppression d'une ressource d'un autre tenant : **404** avec le code `NOT_FOUND`, strictement identique à la réponse pour un identifiant inexistant. Jamais 403 (qui révélerait l'existence de la ressource).
- Les listes ne contiennent que les lignes du tenant ; les compteurs et agrégats aussi.
- Chaque endpoint est livré avec son test d'isolation (un utilisateur du tenant B ne peut ni lire, ni lister, ni modifier, ni supprimer une ressource du tenant A) et son test de permission. Un harnais commun fourni par P1-05 en réduit le coût d'écriture.

### 7. On-premise

Même code, même schéma, RLS active, **un seul tenant** créé à l'installation. Aucun chemin de code « mono-tenant » particulier : cela évite deux comportements à tester.

## Alternatives envisagées

| Alternative                                        | Raison du rejet ou du report                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filtrage applicatif seul                           | Un oubli ou une requête brute suffit à provoquer une fuite ; contraire à la règle 4.3.                                                                                                                              |
| RLS seule, sans filtrage applicatif                | Les erreurs apparaîtraient tard (résultats vides ou erreurs SQL) ; aucune protection si le rôle de connexion est mal configuré ; contraire à la règle 4.3.                                                          |
| Un schéma PostgreSQL par tenant                    | Migrations multipliées par le nombre de tenants, mal outillé avec Prisma, catalogue PostgreSQL qui grossit.                                                                                                         |
| Une base par tenant                                | Isolation physique et sauvegardes par client, mais provisionnement, migrations et pools par base. Non retenue comme mécanisme de base ; le besoin est couvert par une instance dédiée mono-tenant (D-02, option C). |
| `SET` de session + remise à zéro en fin de requête | Fragile : une erreur avant la remise à zéro contamine la connexion ; incompatible avec un pooler en mode transaction.                                                                                               |
| Un rôle PostgreSQL par tenant                      | Ne passe pas à l'échelle avec un pool partagé.                                                                                                                                                                      |

## Conséquences

- **Positif :** deux barrières indépendantes ; échec fermé ; un seul schéma à migrer ; tenant créé instantanément ; on-premise sans divergence de code.
- **Coûts et limites assumés :**
  - Surcoût par requête (transaction + `set_config`), à mesurer dans le spike.
  - Discipline imposée : aucun accès direct au client Prisma, aucune requête SQL brute non revue.
  - La RLS ne protège ni contre un bug dans le code qui positionne le tenant, ni contre un accès avec le rôle propriétaire, ni contre un administrateur de base de données. Elle complète les tests d'isolation, elle ne les remplace pas.
  - Sauvegarde, restauration et export des données **d'un seul tenant** demandent un outillage spécifique (Phase 7).
  - Les opérations légitimement transverses (provisionnement, maintenance) passent par des commandes d'administration hors API, avec un rôle distinct et une trace ; aucun endpoint transverse n'existe (D-13).
  - Si D-02 concluait à « une base par client » comme mécanisme de base, cet ADR serait à réécrire et le lot P1-02 à reprendre.
