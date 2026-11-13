# Backlog — QHSE MANAGER

Backlog priorisé. Les phases 1 et 2 sont découpées en lots courts ; les phases 3 à 7 restent volontairement à gros grain et seront détaillées à leur ouverture.

Dernière mise à jour : 2026-11-13 (Phase 0). Aucun lot de Phase 1 ne démarre avant la validation humaine du cadrage.

## Mode d'emploi

- **Un lot = une tranche verticale** : migration + API + règles métier + écran + tests + documentation, pour un seul objectif vérifiable. Quelques lots de fondation n'ont pas d'écran ; c'est indiqué et justifié dans le lot.
- **Statuts :** `À faire` · `En cours` · `Terminé` · `Bloqué (D-xx)` · `Partiel (D-xx)` (réalisable sur l'hypothèse provisoire de la décision, à reprendre si elle est tranchée autrement).
- **Parallélisation :** colonne « // » des tableaux de synthèse. `SEQ` = strictement après ses dépendances, seul sur ses fichiers ; une lettre (`A`, `B`, …) = piste pouvant être confiée à un agent distinct en même temps que les autres pistes de la même vague.
- Un lot ne passe à `Terminé` que si la « Définition de terminé » du prompt maître (section 7) est satisfaite, sorties de commandes à l'appui.

## Critères communs à tous les lots (CC)

Chaque lot doit satisfaire, en plus de ses critères propres :

- **CC-1 Isolation :** pour **chaque endpoint** ajouté ou modifié, un test d'intégration prouve qu'un utilisateur du tenant B ne peut ni lire, ni lister, ni modifier, ni archiver une ressource du tenant A ; la réponse est `404 NOT_FOUND`, identique à celle d'un identifiant inexistant ; les listes et compteurs ne contiennent aucune ligne de A.
- **CC-2 Permission :** pour chaque endpoint, un test prouve qu'un utilisateur authentifié sans la permission requise reçoit `403 FORBIDDEN`, et qu'un appel non authentifié reçoit `401 UNAUTHENTICATED`. (CC-1 et CC-2 s'appliquent à partir du lot où le mécanisme correspondant existe : P1-02 pour l'isolation au niveau de l'accès aux données, P1-05 pour les endpoints.)
- **CC-3 Audit :** chaque transition d'état et chaque action sensible produit un événement d'audit vérifié par un test (acteur, date serveur, statut précédent, nouveau statut, motif).
- **CC-4 i18n :** aucun texte d'interface en dur ; clés présentes en FR et en EN (un test échoue si une clé manque dans une langue).
- **CC-5 Migrations :** rejouables sur une base vierge ; toute table portant `tenant_id` a la RLS activée et forcée (test de catalogue de P1-02).
- **CC-6 Qualité :** `pnpm lint`, `pnpm typecheck`, `pnpm test` et `pnpm build` passent ; entrées validées côté serveur par des schémas placés dans `packages/shared` ; listes paginées avec limite imposée par le serveur ; erreurs au format unique.
- **CC-7 Preuve :** parcours principal vérifié dans l'application lancée ; ce qui n'a pas été exécuté est dit dans le rapport.

---

# Phase 1 — Fondations

**Sortie de phase (prompt maître) :** un utilisateur se connecte, n'accède qu'aux données de son tenant et de son périmètre ; la CI est verte ; une installation depuis zéro fonctionne en suivant le README.

## Synthèse et ordonnancement

| ID    | Titre                                                             | Dépend de        | Décisions                   | //  | Statut        |
| ----- | ----------------------------------------------------------------- | ---------------- | --------------------------- | --- | ------------- |
| P1-01 | Socle base de données : rôles PostgreSQL et harnais d'intégration | Socle Phase 0    | —                           | SEQ | Livré         |
| P1-02 | Tenants et mécanisme d'isolation (application + RLS)              | P1-01            | D-02, D-12, D-13            | SEQ | Livré         |
| P1-03 | Journal d'audit en ajout seul                                     | P1-02            | D-06 (purge seulement)      | SEQ | Livré         |
| P1-04 | Authentification : connexion, rafraîchissement, déconnexion       | P1-03            | D-12                        | SEQ | Livré         |
| P1-05 | RBAC : rôles, permissions, refus par défaut, harnais de tests     | P1-04            | D-05 (contenu des rôles)    | SEQ | À faire       |
| P1-06 | Structure organisationnelle : entreprises, sites, départements    | P1-05            | —                           | A   | À faire       |
| P1-07 | Périmètres d'accès (entreprise, site, département)                | P1-06            | D-05                        | A   | À faire       |
| P1-08 | Gestion des utilisateurs : invitation, activation, mot de passe   | P1-05            | D-03 (production seulement) | B   | À faire       |
| P1-09 | MFA pour les comptes privilégiés                                  | P1-08            | D-09                        | B   | Bloqué (D-09) |
| P1-10 | i18n FR/EN et paramètres régionaux                                | P1-06            | —                           | A   | À faire       |
| P1-11 | Design system de base                                             | Socle Phase 0    | —                           | W   | À faire       |
| P1-12 | Idempotence et contrôle de version des écritures                  | P1-06            | —                           | A   | À faire       |
| P1-13 | Stockage de fichiers et upload sécurisé                           | P1-05            | D-01 (production seulement) | C   | À faire       |
| P1-14 | Documents, versions contrôlées et numérotation métier             | P1-13, P1-07     | D-06 (purge seulement)      | SEQ | À faire       |
| P1-15 | Clôture de la Phase 1 : installation depuis zéro, E2E, rapport    | Tous les lots P1 | —                           | SEQ | À faire       |

### Parallélisation de la Phase 1

- **Tronc strictement séquentiel :** P1-01 → P1-02 → P1-03 → P1-04 → P1-05. Chacun pose un mécanisme dont le suivant dépend ; ils modifient les mêmes fichiers transverses (module `tenancy`, gardes globaux, schéma Prisma). **Un seul agent à la fois sur `apps/api`.**
- **Piste W (web seul), dès maintenant et en parallèle du tronc :** P1-11 ne touche que `apps/web` et aucune table.
- **Après P1-05, trois pistes parallèles** qui touchent des modules et des tables distincts :
  - **A** — `organization` : P1-06 → P1-07 → P1-10, puis P1-12 (qui modifie les endpoints de P1-06 : jamais en même temps que P1-06/P1-07).
  - **B** — `users`/`auth` : P1-08 → P1-09.
  - **C** — `files` : P1-13.
- **Points de contact à arbitrer par le lead :** P1-07 (table des affectations de rôles) et P1-08 (table `users`) touchent tous deux le voisinage du RBAC — convenir des fichiers avant de lancer ; P1-14 attend la fin des pistes A et C.
- **Condition technique :** le schéma Prisma et le dossier des migrations sont partagés. P1-01 doit dire si le schéma peut être réparti en fichiers par domaine avec la version installée. Dans tous les cas, **les migrations de pistes parallèles sont intégrées une par une par le lead**, chacune rejouée sur base vierge après intégration.

## Lots détaillés

### P1-01 — Socle base de données : rôles PostgreSQL et harnais de tests d'intégration

- **Objectif.** Disposer d'une base où la RLS peut réellement s'appliquer et d'un harnais qui teste l'API contre un PostgreSQL réel, en local comme en CI.
- **Dépendances.** Socle de Phase 0 (monorepo, API avec endpoint de santé, CI).
- **Contenu.** Lot technique sans écran (aucun objet utilisateur).
  1. Deux rôles PostgreSQL : un rôle propriétaire pour les migrations ; un rôle d'exécution pour l'API, non superutilisateur, non propriétaire, sans `BYPASSRLS` (ADR 0002, § 4). Créés par un script d'initialisation en développement et en CI ; variables correspondantes ajoutées à `.env.example` sans secret réel.
  2. Harnais d'intégration : création d'une base de test, application des migrations, exécution des tests avec le rôle d'exécution, nettoyage entre tests.
  3. Vérifier et consigner : possibilité de répartir le schéma Prisma en plusieurs fichiers par domaine avec la version installée ; à défaut, la règle de fusion séquentielle s'applique.
  4. README : démarrage de la base, application des migrations, lancement des tests d'intégration, avec les commandes réelles.
- **Critères d'acceptation.**
  - [x] Un test d'intégration se connecte avec le rôle d'exécution et vérifie dans le catalogue qu'il n'est ni superutilisateur, ni `BYPASSRLS`, ni propriétaire des tables.
  - [x] Le rôle d'exécution ne peut pas exécuter de DDL (test : `CREATE TABLE` refusé).
  - [x] Sur une base vierge, la commande de migration documentée aboutit ; relancée, elle ne fait rien.
  - [x] La CI exécute les tests d'intégration contre son service PostgreSQL et échoue si la base est inaccessible (pas de test ignoré silencieusement).
  - [x] Le résultat du point 3 est écrit dans l'ADR 0001 (section Conséquences).
  - [x] CC-5, CC-6.
- **Livré le 2026-11-13.** Écart : la CI et Docker Compose n'ont pas pu être exécutés dans l'environnement de travail ; le script d'initialisation et les tests ont été validés contre un PostgreSQL 16 local. Aucune migration n'existe encore : « base vierge » a donc été vérifié avec un historique vide.

### P1-02 — Tenants et mécanisme d'isolation (application + RLS)

- **Objectif.** Prouver, avant toute table métier, que les données de deux tenants sont étanches par deux barrières indépendantes.
- **Dépendances.** P1-01. Décisions : D-02 (modèle d'isolation — hypothèse provisoire : base partagée + RLS), D-12 (unicité de l'e-mail — hypothèse : par tenant), D-13 (provisionnement — hypothèse : commande d'administration).
- **Contenu.** Lot technique sans écran. Commence par un **spike** qui départage les deux variantes de l'ADR 0002, § 5 ; le résultat met à jour l'ADR.
  1. Table `tenants` (non filtrée par tenant) ; table `users` minimale (`id`, `tenant_id`, `email`, `status`, colonnes techniques de l'ADR 0004). `users` est créée ici parce qu'il faut une première table à portée tenant pour prouver le mécanisme ; elle est complétée par P1-04.
  2. Contexte de requête (tenant, utilisateur) et client de données à portée tenant, seul point d'accès autorisé (ADR 0002, § 2 et 3). Générateur d'UUID v7 (ADR 0004, § 1).
  3. Politique RLS, `ENABLE` + `FORCE`, clés étrangères composites.
  4. Commande d'administration de création d'un tenant (D-13, option A).
- **Critères d'acceptation.**
  - [x] Barrière 2 seule : avec le rôle d'exécution et **sans passer par la couche applicative** (SQL direct), une session positionnée sur le tenant A ne voit, ne modifie et ne supprime aucune ligne de B ; l'insertion d'une ligne portant le `tenant_id` de B est refusée.
  - [x] Échec fermé : sans tenant positionné, une lecture renvoie zéro ligne et une écriture est refusée.
  - [x] Barrière 1 seule : le client à portée tenant écrase tout `tenant_id` fourni par l'appelant et filtre lectures, mises à jour et archivages ; un accès hors contexte lève une erreur.
  - [x] Pas de fuite par le pool : test de concurrence alternant au moins 200 requêtes de deux tenants sur un pool limité à 2 connexions, sans aucune ligne de l'autre tenant.
  - [x] Test de catalogue : échoue si une table possédant `tenant_id` n'a pas la RLS activée et forcée avec la politique attendue (réutilisé par CC-5).
  - [x] Test d'architecture ou règle de lint : l'import du client Prisma brut hors du module `tenancy` fait échouer la vérification.
  - [x] Une clé étrangère vers une ligne d'un autre tenant est refusée par la base.
  - [x] La commande de création de tenant est documentée et testée ; aucun endpoint HTTP ne permet de créer ou de lister des tenants.
  - [x] Surcoût mesuré de la variante retenue consigné dans l'ADR 0002 ; statut de l'ADR mis à jour.
  - [x] CC-5, CC-6.
- **Livré le 2026-11-13** sur la décision D-02 (base partagée) et les hypothèses provisoires D-12 et D-13. Variante retenue : une transaction par unité de travail (`TenantDatabase.run`). Le garde HTTP qui établit le contexte tenant à partir de la session relève de P1-04.

### P1-03 — Journal d'audit en ajout seul

- **Objectif.** Fournir le service d'audit que tous les lots suivants utiliseront, avec un refus de modification garanti par la base.
- **Dépendances.** P1-02. Décision : D-06 (seulement pour la purge, non développée ici).
- **Contenu.** Table `audit_events` et module `audit` (ADR 0005) ; écriture dans la transaction métier ; privilèges, politiques RLS `INSERT`/`SELECT` et déclencheur de refus. Lot sans écran ni endpoint : la consultation arrive avec P1-05, quand les permissions existent.
- **Critères d'acceptation.**
  - [x] Avec le rôle d'exécution, `UPDATE`, `DELETE` et `TRUNCATE` sur `audit_events` sont refusés (trois tests).
  - [x] Atomicité : si la transaction métier est annulée, aucun événement n'est écrit ; si l'écriture de l'événement échoue, la modification métier est annulée.
  - [x] `occurred_at` est fixé par le serveur ; une valeur fournie par l'appelant est ignorée.
  - [x] Un événement du tenant A est invisible depuis le contexte du tenant B (isolation au niveau de l'accès aux données).
  - [x] Le service refuse d'enregistrer une transition sans statut précédent, nouveau statut et acteur.
  - [x] Faisabilité du partitionnement par période vérifiée et consignée dans l'ADR 0005 (mis en place, ou reporté avec la dette écrite).
  - [x] CC-5, CC-6.
- **Livré le 2026-11-13.** Partitionnement vérifié faisable et reporté (dette dans l'ADR 0005). Écart : politique RLS unique au lieu de politiques `INSERT`/`SELECT` (justifié dans l'ADR).

### P1-04 — Authentification : connexion, rafraîchissement, déconnexion

- **Objectif.** Un utilisateur existant se connecte depuis le web, garde sa session et se déconnecte ; le tenant de chaque requête vient désormais de la session.
- **Dépendances.** P1-03. Décision : D-12 (hypothèse provisoire : option A). ADR 0003.
- **Contenu.** Complément de `users` (hachage Argon2id) ; table des jetons de rafraîchissement (familles) ; endpoints `POST /api/v1/auth/login`, `/refresh`, `/logout`, `GET /api/v1/auth/me` ; garde global d'authentification qui alimente le contexte tenant ; limitation de débit et verrouillage progressif ; écran de connexion web, garde de routes, rafraîchissement silencieux. Les comptes sont créés par la commande d'administration (un administrateur initial par tenant) jusqu'à P1-08.
- **Critères d'acceptation.**
  - [x] Connexion valide : jeton d'accès + cookie de rafraîchissement `HttpOnly` ; `GET /auth/me` renvoie l'utilisateur et son tenant.
  - [x] Les réponses pour compte inconnu, mot de passe faux et tenant inconnu sont identiques (corps et statut).
  - [x] Rotation : un jeton de rafraîchissement utilisé une fois ne fonctionne plus ; sa réutilisation hors fenêtre de grâce révoque toute la famille et crée un événement d'audit.
  - [x] Fenêtre de grâce : le rejeu immédiat du jeton précédent ne déconnecte pas l'utilisateur (test) ; la fenêtre est paramétrable.
  - [x] Après N échecs, le délai imposé augmente (test avec horloge simulée) ; la limitation de débit répond `429 RATE_LIMITED`.
  - [x] Aucun mot de passe, hachage ni jeton dans les réponses et les journaux (test sur la sortie des journaux).
  - [x] Jeton d'accès expiré, mal signé, ou portant un tenant modifié : `401`.
  - [x] **CC-1 :** un jeton du tenant B ne permet d'obtenir par `/auth/me` aucune donnée de A ; un jeton de rafraîchissement de A présenté dans le contexte de B est refusé.
  - [x] **CC-2 (partie authentification) :** toute route non marquée publique répond `401` sans jeton — test générique parcourant toutes les routes enregistrées.
  - [x] Événements d'audit : connexion réussie, échec sur compte connu, déconnexion, révocation de famille (CC-3).
  - [x] Fonctionnement du cookie vérifié en développement (origines 5173/3000) et documenté pour un déploiement derrière reverse proxy.
  - [x] Écran de connexion en FR et EN, états de chargement et d'erreur (CC-4) ; CC-5, CC-6, CC-7.
- **Livré le 2026-11-13** sur la décision D-12 (code d'organisation). Écart : dans la fenêtre de grâce, un nouveau successeur est émis au lieu du même (ADR 0003). Reste à faire consigné dans l'ADR (purge des sessions expirées, re-hachage, mots de passe courants).

### P1-05 — RBAC : rôles, permissions, refus par défaut, harnais de tests

- **Objectif.** Aucune route n'est accessible sans permission déclarée ; un administrateur de tenant gère rôles et attributions ; les lots suivants disposent d'un harnais qui rend CC-1 et CC-2 peu coûteux.
- **Dépendances.** P1-04. Décision : D-05 (contenu des rôles de référence — le mécanisme n'est pas bloqué). `docs/ROLES-PERMISSIONS.md`.
- **Contenu.** Catalogue de permissions `resource:action` défini dans le code (`packages/shared`) ; tables des rôles, des permissions par rôle et des attributions (périmètre « tenant » uniquement à ce stade) ; garde global de permission ; endpoints de gestion des rôles et des attributions ; endpoint de consultation du journal d'audit (`audit-log:read`) ; écrans web : liste des rôles, détail d'un rôle, attribution à un utilisateur, consultation du journal d'audit ; harnais de tests paramétré (isolation + permission) ; rôles de référence installés à la création d'un tenant.
- **Critères d'acceptation.**
  - [ ] Refus par défaut : un test parcourt toutes les routes enregistrées et échoue si l'une n'a ni permission déclarée ni marquage public explicite ; une route ajoutée sans déclaration répond `403`.
  - [ ] Les permissions sont évaluées côté serveur à chaque requête : le retrait d'un rôle prend effet à la requête suivante, sans reconnexion (test).
  - [ ] Un utilisateur ne peut pas s'attribuer un rôle ni attribuer une permission qu'il ne détient pas (test d'élévation de privilèges).
  - [ ] Tout changement de droits (création ou modification de rôle, attribution, retrait) crée un événement d'audit (CC-3).
  - [ ] Le dernier administrateur d'un tenant ne peut pas se retirer son rôle.
  - [ ] **CC-1 et CC-2** pour chaque endpoint de rôles, d'attributions et du journal d'audit, écrits avec le harnais ; le harnais est documenté dans le guide de contribution.
  - [ ] Écrans en FR/EN avec états vide, chargement et erreur ; menus masqués sans permission, le serveur restant seul juge (CC-4).
  - [ ] `docs/ROLES-PERMISSIONS.md` mis à jour avec les clés réellement implémentées ; CC-5, CC-6, CC-7.

### P1-06 — Structure organisationnelle : entreprises, sites, départements

- **Objectif.** L'administrateur d'un tenant décrit son organisation : entreprises, sites (pays, fuseau horaire, devise), départements.
- **Dépendances.** P1-05.
- **Contenu.** Tables `companies`, `sites`, `departments` ; endpoints de création, lecture, liste (pagination, filtres, tri), modification et archivage logique pour chacune ; écrans web liste + formulaire. Un site porte un pays, un fuseau horaire IANA et une devise. Aucune notion de projet ni de contrat dans ce lot (voir « Points à clarifier »).
- **Critères d'acceptation.**
  - [ ] Fuseau horaire, pays et devise validés contre des listes de référence (valeur inconnue : `400 VALIDATION_FAILED`).
  - [ ] Archivage logique : une entité archivée disparaît des listes par défaut, reste consultable par filtre ; aucune suppression physique n'est exposée.
  - [ ] Un département ne peut être rattaché qu'à un site du même tenant (refus prouvé au niveau de l'API **et** de la base).
  - [ ] Unicité du code d'entreprise et de site **par tenant** : le même code peut exister dans deux tenants.
  - [ ] Listes : taille de page supérieure à la limite refusée ; tri et filtres couverts par des tests.
  - [ ] Création, modification et archivage tracés (CC-3).
  - [ ] **CC-1 et CC-2** pour chacun des endpoints des trois ressources.
  - [ ] Écrans FR/EN, états vide/chargement/erreur, avertissement avant perte de saisie (CC-4) ; CC-5, CC-6, CC-7.

### P1-07 — Périmètres d'accès (entreprise, site, département)

- **Objectif.** Un rôle est attribué sur un périmètre ; un utilisateur ne voit et ne modifie que ce qui relève de ses périmètres.
- **Dépendances.** P1-06. Décision : D-05.
- **Contenu.** L'attribution de rôle porte un type de périmètre (`tenant`, `company`, `site`, `department`) et l'identifiant correspondant ; le type est extensible à `project` et `contract`, **sans** créer ces entités maintenant ; résolution centralisée des périmètres effectifs (un périmètre « entreprise » couvre ses sites, un périmètre « site » ses départements) ; filtre de périmètre appliqué de façon centralisée, comme le filtre tenant ; application aux endpoints de P1-06 ; écran d'attribution avec choix du périmètre.
- **Critères d'acceptation.**
  - [ ] Un utilisateur dont le rôle porte sur le site S1 ne lit, ne liste et ne modifie aucun département de S2 du **même tenant** : `404` en accès direct, absence dans les listes.
  - [ ] Héritage : un périmètre « entreprise » donne accès à tous ses sites et à leurs départements ; un périmètre « tenant » à tout.
  - [ ] Cumul : deux attributions sur deux sites donnent l'union des périmètres, pas l'intersection.
  - [ ] Attribuer un rôle sur un périmètre d'un autre tenant est refusé (`404`).
  - [ ] Un utilisateur ne peut attribuer un rôle que dans les limites de son propre périmètre.
  - [ ] Le retrait d'une attribution prend effet à la requête suivante ; tout changement est tracé (CC-3).
  - [ ] Le harnais de P1-05 est étendu par un **test de périmètre** réutilisable par les lots métier ; CC-1 et CC-2 restent verts sur les endpoints de P1-05 et P1-06.
  - [ ] `docs/ROLES-PERMISSIONS.md` mis à jour ; CC-4, CC-5, CC-6, CC-7.

### P1-08 — Gestion des utilisateurs : invitation, activation, désactivation, mot de passe

- **Objectif.** Un administrateur invite, désactive et réactive les utilisateurs de son tenant ; chacun gère son mot de passe.
- **Dépendances.** P1-05. Décision : D-03 (uniquement pour le fournisseur de production ; le lot utilise un relais SMTP de test local).
- **Contenu.** Endpoints de liste, invitation, détail, modification, désactivation et réactivation des utilisateurs ; activation par lien à usage unique ; mot de passe oublié et changement de mot de passe ; port interne d'envoi d'e-mail avec transport SMTP ; gabarits d'e-mail FR/EN ; écrans web correspondants.
- **Critères d'acceptation.**
  - [ ] Jetons d'invitation et de réinitialisation : à usage unique, expirants, stockés hachés (tests : second usage refusé, jeton expiré refusé).
  - [ ] « Mot de passe oublié » répond de façon identique que le compte existe ou non.
  - [ ] Désactiver un compte ou changer son mot de passe révoque ses sessions : le jeton de rafraîchissement est refusé juste après (test).
  - [ ] Politique de mot de passe appliquée côté serveur (trop court ou trop courant : `400`).
  - [ ] Même adresse e-mail acceptée dans deux tenants distincts, refusée en double dans un même tenant (hypothèse D-12 A).
  - [ ] L'e-mail part dans la langue de l'utilisateur ; en test, il est capturé et son contenu vérifié ; aucun envoi réel.
  - [ ] Invitation, activation, désactivation, réactivation, changement et réinitialisation de mot de passe tracés (CC-3).
  - [ ] **CC-1 et CC-2** pour chaque endpoint d'utilisateurs ; les routes publiques (activation, mot de passe oublié) sont soumises à la limitation de débit (test).
  - [ ] Écrans FR/EN (CC-4) ; CC-5, CC-6, CC-7.

### P1-09 — MFA pour les comptes privilégiés

- **Objectif.** Les comptes privilégiés ne peuvent pas utiliser la plateforme sans second facteur.
- **Dépendances.** P1-08. Décision : **D-09 (bloquant)** — hypothèse provisoire : TOTP + codes de secours.
- **Contenu.** Enrôlement TOTP, vérification à la connexion en deux étapes, codes de secours à usage unique, réinitialisation par un administrateur, écrans web.
- **Critères d'acceptation.**
  - [ ] Un compte détenant une permission privilégiée (liste de D-09) sans MFA enrôlé ne peut appeler que les endpoints d'enrôlement ; tout autre appel est refusé.
  - [ ] Aucun jeton d'accès complet n'est émis avant la validation du second facteur.
  - [ ] Code TOTP valide accepté une seule fois ; tolérance de décalage d'horloge bornée et testée ; codes erronés soumis à la limitation de débit.
  - [ ] Code de secours utilisable une seule fois ; secret TOTP chiffré au repos et jamais renvoyé après l'enrôlement.
  - [ ] Réinitialisation par un administrateur : permission dédiée, impossible sur soi-même, tracée (CC-3).
  - [ ] **CC-1 et CC-2** pour chaque endpoint MFA.
  - [ ] Écrans FR/EN (CC-4) ; CC-5, CC-6, CC-7.

### P1-10 — i18n FR/EN et paramètres régionaux

- **Objectif.** Chaque utilisateur travaille dans sa langue ; dates et nombres s'affichent selon le site et la langue.
- **Dépendances.** P1-06 (fuseau du site). Le socle web contient déjà i18next ; ce lot le complète.
- **Contenu.** Préférence de langue enregistrée sur le profil (endpoint de mise à jour du profil) ; sélecteur de langue ; utilitaires partagés de formatage (dates dans le fuseau du site, nombres, devise) ; messages d'erreur de l'API traduits côté client à partir du **code d'erreur stable** ; convention de nommage des clés ; test de complétude des traductions.
- **Critères d'acceptation.**
  - [ ] Le changement de langue est immédiat et persistant d'une session à l'autre.
  - [ ] Un test échoue si une clé existe en FR sans équivalent EN, ou l'inverse (support de CC-4).
  - [ ] Une date stockée en UTC s'affiche dans le fuseau **du site** concerné, avec le fuseau indiqué (tests sur deux fuseaux et sur un changement de jour).
  - [ ] Les montants sont formatés par devise (cas XAF, sans décimales, couvert par un test).
  - [ ] Chaque code de `ERROR_CODES` a un message en FR et en EN ; un code inconnu donne un message générique, jamais un texte technique brut.
  - [ ] Ajouter une langue (portugais prévu) ne demande qu'un fichier de traductions et une entrée dans la liste des langues (vérifié par un test avec une langue factice).
  - [ ] **CC-1 et CC-2** pour l'endpoint de profil ; CC-5, CC-6, CC-7.

### P1-11 — Design system de base

- **Objectif.** Un jeu de composants accessibles commun à tous les écrans, pour éviter que chaque lot invente les siens.
- **Dépendances.** Socle web de Phase 0. Aucune table, aucun endpoint.
- **Contenu.** Jetons de design (couleurs, espacements, typographie) ; composants : bouton, champ de formulaire avec message d'erreur, sélecteur, case à cocher, boîte de dialogue, notification, tableau paginé (recherche, tri, état vide), en-tête de page, navigation principale adaptable mobile/tablette, indicateurs de chargement et d'erreur ; page de démonstration interne.
- **Critères d'acceptation.**
  - [ ] Chaque composant a des tests (rendu, navigation au clavier, attributs d'accessibilité).
  - [ ] Contraste WCAG AA vérifié pour chaque couple texte/fond des jetons (test automatisé sur les valeurs).
  - [ ] Cibles tactiles d'au moins 44 × 44 px sur les éléments interactifs.
  - [ ] Aucun texte en dur dans les composants (libellés passés par i18n) (CC-4).
  - [ ] Pas de nouvelle dépendance lourde sans justification écrite ; taille du bundle avant/après consignée dans le rapport.
  - [ ] Utilisable à 360 px de large sans défilement horizontal (vérifié dans l'application lancée).
  - [ ] CC-6, CC-7.

### P1-12 — Idempotence et contrôle de version des écritures

- **Objectif.** Rejouer une écriture ne crée aucun doublon ; deux modifications concurrentes ne s'écrasent pas en silence. Mécanisme prouvé sur les endpoints de P1-06, puis obligatoire pour tous les lots suivants.
- **Dépendances.** P1-06. ADR 0004, § 1, 3 et 4.
- **Contenu.** Traitement de l'en-tête `Idempotency-Key` (table des clés, écrite dans la transaction) ; acceptation d'un `id` fourni par le client à la création ; contrôle de la `version` à la modification ; prise en charge côté web (clé générée par soumission de formulaire, message en cas de conflit).
- **Critères d'acceptation.**
  - [ ] Même clé et même contenu envoyés deux fois : une seule ligne créée, deux réponses identiques.
  - [ ] Même clé, contenu différent : `409 CONFLICT`.
  - [ ] Deux requêtes simultanées avec la même clé : une seule création (test de concurrence).
  - [ ] Création avec un `id` fourni : accepté s'il est bien formé, `400` sinon ; même `id` rejoué avec un contenu identique : pas de doublon.
  - [ ] Un `id` déjà utilisé par un **autre tenant** produit une réponse indiscernable d'un conflit ordinaire et ne révèle rien de l'autre tenant (CC-1).
  - [ ] Modification avec une `version` périmée : `409`, rien n'est écrasé ; l'écran propose de recharger.
  - [ ] Une clé d'idempotence du tenant A n'a aucun effet dans le tenant B.
  - [ ] Points laissés ouverts par l'ADR 0004 tranchés et consignés (UUID v4 en entrée, en-tête obligatoire ou non, durée de conservation de départ).
  - [ ] CC-1 et CC-2 restent verts sur les endpoints modifiés ; CC-5, CC-6, CC-7.

### P1-13 — Stockage de fichiers et upload sécurisé

- **Objectif.** Déposer et récupérer un fichier de façon sûre, sur un stockage compatible S3 (MinIO en local et on-premise).
- **Dépendances.** P1-05. Décision : D-01 (uniquement pour le stockage de production).
- **Contenu.** Service MinIO ajouté au Docker Compose de développement ; module `files` ; table des métadonnées de fichier ; endpoints de dépôt, de métadonnées et d'obtention d'une URL de téléchargement signée ; composant web de dépôt avec progression et reprise après erreur.
- **Critères d'acceptation.**
  - [ ] Type **réel** contrôlé sur le contenu : un exécutable renommé en `.pdf` est refusé (test).
  - [ ] Taille maximale appliquée côté serveur ; liste blanche de types configurable.
  - [ ] Nom d'origine assaini et conservé comme simple métadonnée ; la clé de stockage est générée par le serveur et préfixée par tenant (test avec `../` et caractères spéciaux).
  - [ ] Aucun fichier servi directement : téléchargement uniquement par URL signée de courte durée, délivrée après contrôle de permission ; URL expirée refusée (test).
  - [ ] Empreinte (hash) calculée et stockée ; elle est vérifiée au téléchargement de contrôle.
  - [ ] Analyse antivirus : point d'extension prévu et désactivé par défaut ; l'absence d'antivirus est écrite dans la documentation (pas de fausse assurance).
  - [ ] Dépôt et délivrance d'URL tracés (CC-3).
  - [ ] **CC-1 et CC-2** pour chaque endpoint : un utilisateur du tenant B n'obtient ni métadonnées ni URL signée pour un fichier de A.
  - [ ] Aucune dépendance à un service cloud propriétaire : tests exécutés contre MinIO.
  - [ ] CC-4, CC-5, CC-6, CC-7.

### P1-14 — Documents, versions contrôlées et numérotation métier

- **Objectif.** Créer un document, en publier des versions successives sans perdre les anciennes, avec un numéro lisible attribué par le serveur.
- **Dépendances.** P1-13, P1-07 (un document est rattaché à un périmètre). Décision : D-06 (purge seulement). ADR 0004, § 2.
- **Contenu.** Service de numérotation par tenant (table de compteurs, format configurable) — créé ici avec son premier consommateur ; tables des documents et de leurs versions ; endpoints de création, liste, détail, ajout de version, archivage ; écrans liste, fiche et historique des versions. Le circuit de validation documentaire avancé relève de la Phase 3.
- **Critères d'acceptation.**
  - [ ] Numéros : séquentiels par tenant et par type, sans doublon sous 50 créations concurrentes (test) ; deux tenants ont chacun leur numéro 1 ; un numéro n'est jamais réattribué.
  - [ ] Une création annulée ne consomme pas de numéro (test de transaction annulée).
  - [ ] Ajouter une version n'altère ni ne supprime les précédentes ; une version publiée est immuable (toute modification refusée).
  - [ ] Une seule version « courante » par document, garantie par une contrainte en base.
  - [ ] Le téléchargement d'une ancienne version reste possible pour qui en a la permission, et il est tracé.
  - [ ] Archivage logique uniquement ; création, nouvelle version et archivage tracés (CC-3).
  - [ ] **CC-1, CC-2 et test de périmètre** pour chaque endpoint.
  - [ ] Idempotence et contrôle de version de P1-12 appliqués aux créations et modifications.
  - [ ] Écrans FR/EN (CC-4) ; CC-5, CC-6, CC-7.

### P1-15 — Clôture de la Phase 1

- **Objectif.** Démontrer les critères de sortie de la phase et obtenir la validation humaine.
- **Dépendances.** Tous les lots P1 terminés (P1-09 peut être reporté si D-09 reste ouverte, avec mention explicite dans le rapport).
- **Critères d'acceptation.**
  - [ ] Installation depuis zéro rejouée sur un environnement vierge en suivant **uniquement** le README ; chaque écart corrigé dans le README.
  - [ ] Test de bout en bout : connexion → un utilisateur du site S1 du tenant A ne voit ni les données de S2, ni celles du tenant B.
  - [ ] Revue d'isolation : liste de tous les endpoints avec, pour chacun, la référence de ses tests d'isolation et de permission ; aucun manquant.
  - [ ] Seed de démonstration étiqueté « DÉMO », refusant de s'exécuter si l'environnement est la production (test).
  - [ ] CI verte sur le commit de fin de phase (lien ou sortie à l'appui).
  - [ ] Documentation à jour : schéma de base de données, OpenAPI générée, variables d'environnement, guide de contribution.
  - [ ] Rapport de phase rédigé, dette et écarts listés ; **arrêt et attente de validation** avant la Phase 2.

---

# Phase 2 — MVP QHSE

**Sortie de phase (prompt maître) :** test E2E de la chaîne incident → enquête → CAPA → vérification → clôture, avec permissions et journal d'audit.

Les états et transitions cités ci-dessous sont des **propositions** à valider avec un praticien QHSE (D-05, D-10) ; chaque lot commence par écrire sa table de transitions dans la documentation du module.

## Synthèse et ordonnancement

| ID    | Titre                                                           | Dépend de           | Décisions | //  | Statut         |
| ----- | --------------------------------------------------------------- | ------------------- | --------- | --- | -------------- |
| P2-01 | Référentiel de classification des incidents                     | Phase 1 validée     | D-10      | SEQ | Partiel (D-10) |
| P2-02 | Déclaration d'incident et moteur de machine à états             | P2-01               | D-05      | SEQ | À faire        |
| P2-03 | Incidents : qualification, traitement et clôture                | P2-02               | D-05      | A   | À faire        |
| P2-04 | Incidents : pièces jointes et photos                            | P2-02               | —         | A   | À faire        |
| P2-05 | Enquêtes                                                        | P2-03               | D-05      | A   | À faire        |
| P2-06 | CAPA : création, affectation, suivi                             | P2-02               | —         | B   | À faire        |
| P2-07 | CAPA : workflow, preuve, vérification d'efficacité, réouverture | P2-06               | D-05      | B   | À faire        |
| P2-08 | Matrices de risques configurables et versionnées                | P2-02               | D-10      | C   | Partiel (D-10) |
| P2-09 | Registre des risques : évaluations initiale et résiduelle       | P2-08               | —         | C   | À faire        |
| P2-10 | Modèles de checklists versionnés                                | P2-02               | —         | D   | À faire        |
| P2-11 | Inspections : planification, exécution, constats                | P2-10, P2-06        | —         | D   | À faire        |
| P2-12 | Heures travaillées                                              | Phase 1 validée     | D-11      | E   | Bloqué (D-11)  |
| P2-13 | Moteur de KPI et dictionnaire en configuration                  | P2-12, P2-03        | D-11      | E   | Bloqué (D-11)  |
| P2-14 | Dashboard par rôle et périmètre                                 | P2-13, P2-07, P2-11 | D-11      | SEQ | Bloqué (D-11)  |
| P2-15 | Exports CSV et XLSX                                             | P2-03, P2-07        | —         | F   | À faire        |
| P2-16 | Exports PDF                                                     | P2-05, P2-07        | —         | F   | À faire        |
| P2-17 | Notifications d'affectation et d'échéance (**à confirmer**)     | P2-07               | D-03      | F   | Bloqué (D-03)  |
| P2-18 | Clôture de la Phase 2 : E2E de la chaîne complète, rapport      | Tous les lots P2    | —         | SEQ | À faire        |

### Parallélisation de la Phase 2

- **Séquentiel d'abord :** P2-01 → P2-02. P2-02 crée le moteur de machine à états que tous les autres workflows utilisent : personne ne démarre un autre workflow avant sa livraison.
- **Ensuite, cinq pistes** sur des modules et des tables distincts :
  - **A** — `incidents` : P2-03, P2-04 (l'un après l'autre : mêmes fichiers), puis P2-05 (`investigations`).
  - **B** — `capa` : P2-06 → P2-07.
  - **C** — `risks` : P2-08 → P2-09.
  - **D** — `inspections` : P2-10 → P2-11 (P2-11 attend aussi P2-06).
  - **E** — `worked-hours` / `kpi` : P2-12 peut démarrer dès l'ouverture de la phase (aucune dépendance à P2-02) ; P2-13 attend P2-03.
- **Condition du parallélisme B/A/D :** une CAPA référence sa source par un couple (type de source, identifiant), validé par le service du module source, et non par une clé étrangère vers `incidents` ou `inspections`. Ainsi la piste B ne modifie aucune table des pistes A et D. Compromis : l'intégrité référentielle de ce lien est applicative, pas garantie par la base — à couvrir par des tests.
- **Piste F**, en fin de phase : P2-15, P2-16, P2-17 touchent des modules transverses distincts (`exports`, `pdf`, `notifications`) mais lisent les modules métier : à lancer quand ces derniers sont stables.
- **Séquentiels :** P2-14 (lit tous les modules) et P2-18.
- Même règle que pour la Phase 1 : migrations intégrées une par une par le lead.

## Lots détaillés

### P2-01 — Référentiel de classification des incidents

- **Objectif.** Un administrateur QHSE configure, pour son tenant (avec surcharge possible par site), les types d'événement et les niveaux de gravité utilisés à la déclaration.
- **Dépendances.** Phase 1 validée. Décision : D-10 (contenu « DÉMO »).
- **Contenu.** Tables de référentiel (types d'événement, dont accident, presque-accident, observation ; niveaux de gravité réelle et potentielle) ; endpoints et écran d'administration ; jeu « DÉMO » dans le seed de démonstration uniquement.
- **Critères d'acceptation.**
  - [ ] Une valeur déjà utilisée ne peut être que désactivée, jamais supprimée ni vidée de son sens (son code est immuable).
  - [ ] Résolution site → tenant : la valeur du site l'emporte si elle existe (tests des deux cas).
  - [ ] Libellés saisis en FR et en EN ; l'absence d'une langue est signalée à l'enregistrement.
  - [ ] Aucun référentiel n'est codé en dur dans le code métier (les types sont des données).
  - [ ] Le jeu « DÉMO » est étiqueté comme tel à l'écran et absent d'un tenant créé hors seed de démonstration.
  - [ ] Modifications tracées (CC-3) ; **CC-1, CC-2 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-02 — Déclaration d'incident et moteur de machine à états

- **Objectif.** Tout utilisateur autorisé déclare un incident, un presque-accident ou une observation en quelques champs, l'enregistre en brouillon puis le soumet.
- **Dépendances.** P2-01. Décision : D-05 (rôles par transition).
- **Contenu.** Module technique `workflow` : table déclarative des transitions (état de départ, état d'arrivée, permission requise, conditions, motif obligatoire ou non), refus de toute transition non listée, écriture d'audit systématique. Table `incidents` (numéro métier, site, date et heure de l'événement, type, gravité, description, déclarant) ; endpoints de création, modification du brouillon, soumission, liste, détail ; écrans : formulaire de déclaration utilisable sur mobile (brouillon enregistré automatiquement), liste filtrable, fiche. États de ce lot : `draft` → `submitted`.
- **Critères d'acceptation.**
  - [ ] Moteur : une transition absente de la table est refusée (`409 CONFLICT`) ; une transition listée sans la permission requise est refusée (`403`) ; test générique parcourant **toutes** les paires d'états.
  - [ ] Chaque transition réussie écrit un événement d'audit complet dans la même transaction (CC-3).
  - [ ] Le changement de statut n'est possible que par l'endpoint de transition : une modification directe du champ `status` est ignorée ou refusée (test).
  - [ ] Numéro attribué par le serveur à la création ; idempotence et `id` fourni par le client acceptés (P1-12).
  - [ ] La date de l'événement est saisie dans le fuseau du site, stockée en UTC ; une date future est refusée.
  - [ ] Un brouillon n'est visible que de son auteur ; un incident soumis l'est selon le périmètre.
  - [ ] Après soumission, les champs de déclaration ne sont plus modifiables par le déclarant.
  - [ ] **CC-1, CC-2 et test de périmètre** pour chaque endpoint.
  - [ ] Formulaire : validation claire, avertissement avant perte de saisie, utilisable à 360 px ; CC-4 à CC-7.

### P2-03 — Incidents : qualification, traitement et clôture

- **Objectif.** Le responsable QHSE qualifie l'incident soumis, décide d'une enquête, puis le clôture ou le rejette avec motif.
- **Dépendances.** P2-02. Décision : D-05.
- **Contenu.** États proposés : `submitted` → `under_review` → `investigating` → `pending_closure` → `closed` ; `rejected` (motif obligatoire) ; `reopened`. Qualification (classification confirmée, gravité réelle et potentielle) ; écran de traitement avec historique des transitions.
- **Critères d'acceptation.**
  - [ ] Table des transitions documentée dans le module et testée exhaustivement.
  - [ ] Rejet et réouverture exigent un motif non vide ; refusés sinon.
  - [ ] Séparation des tâches : si la règle du site est active, le déclarant ne peut pas clôturer son propre incident (tests règle active et inactive).
  - [ ] Un incident clôturé est en lecture seule ; seule la transition de réouverture est possible, avec permission dédiée.
  - [ ] L'historique affiché provient du journal d'audit, pas d'un champ modifiable.
  - [ ] **CC-1, CC-2, CC-3 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-04 — Incidents : pièces jointes et photos

- **Objectif.** Joindre des photos et des documents à un incident.
- **Dépendances.** P2-02 (et P1-13).
- **Critères d'acceptation.**
  - [ ] Ajout et retrait (archivage logique) de pièces jointes tant que l'état l'autorise ; refus sur un incident clôturé.
  - [ ] Les images sont redimensionnées ou compressées avant envoi côté client ; l'original n'est pas exigé (poids mesuré et consigné).
  - [ ] L'accès à une pièce jointe suit la permission et le périmètre **de l'incident**, par URL signée.
  - [ ] Un envoi interrompu peut être repris sans doublon.
  - [ ] Ajout et retrait tracés (CC-3) ; **CC-1, CC-2 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-05 — Enquêtes

- **Objectif.** Mener l'enquête liée à un incident : équipe, faits, causes, conclusions, validation.
- **Dépendances.** P2-03. Décision : D-05.
- **Contenu.** Tables de l'enquête (responsable, membres, chronologie des faits, causes immédiates et profondes en texte structuré, conclusions) ; aucune méthode d'analyse imposée ni contenu de méthode protégé reproduit. États proposés : `open` → `in_progress` → `submitted` → `approved` ; `returned` (motif obligatoire). Écrans correspondants.
- **Critères d'acceptation.**
  - [ ] Une enquête ne peut être ouverte que sur un incident à l'état `investigating` ; une seule enquête active par incident.
  - [ ] Séparation des tâches : si la règle est active, l'approbateur n'est ni le responsable ni un membre de l'équipe.
  - [ ] Une enquête approuvée est immuable ; une correction passe par un retour motivé et tracé.
  - [ ] L'incident ne peut passer à `pending_closure` que si son enquête, quand elle est exigée, est approuvée (condition vérifiée par le serveur).
  - [ ] Les membres de l'équipe accèdent à l'enquête même hors de leur périmètre habituel, pour la durée de l'enquête seulement (test).
  - [ ] **CC-1, CC-2, CC-3 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-06 — CAPA : création, affectation, suivi

- **Objectif.** Créer une action corrective ou préventive, autonome ou issue d'une source, l'affecter et suivre son échéance.
- **Dépendances.** P2-02.
- **Contenu.** Table des actions (numéro, type, priorité dont « critique », responsable, échéance, source = type + identifiant) ; endpoints et écrans : liste « mes actions », liste filtrable (retard, priorité, site), fiche. États de ce lot : `open` → `in_progress`.
- **Critères d'acceptation.**
  - [ ] Une source est validée par le module concerné : source inexistante, d'un autre tenant ou hors périmètre refusée (`404`).
  - [ ] Le responsable désigné doit appartenir au tenant et avoir accès au périmètre de l'action.
  - [ ] Le retard est calculé par le serveur à partir de l'échéance et du fuseau du site (tests autour de minuit).
  - [ ] Tout changement d'échéance ou de responsable exige un motif et est tracé (CC-3).
  - [ ] La fiche d'un incident liste ses actions sans que le module CAPA lise les tables d'incidents (passage par les services publics).
  - [ ] **CC-1, CC-2 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-07 — CAPA : workflow, preuve, vérification d'efficacité, réouverture

- **Objectif.** Appliquer la règle du prompt maître (5.3) : pas de clôture d'une action critique sans preuve ni vérification d'efficacité, la vérification étant faite par une autre personne.
- **Dépendances.** P2-06. Décision : D-05.
- **Contenu.** États proposés : `in_progress` → `completed` → `pending_verification` → `verified` → `closed` ; `reopened` ; `cancelled` (motif obligatoire). Preuves (pièces jointes via P1-13) ; règles par site : preuve obligatoire, vérification obligatoire ; écran de vérification.
- **Critères d'acceptation.**
  - [ ] Action critique, règle active : clôture refusée sans preuve ; clôture refusée sans vérification d'efficacité enregistrée (deux tests distincts).
  - [ ] Le vérificateur ne peut **jamais** être le responsable de l'action, quelle que soit la configuration du site.
  - [ ] Vérification « inefficace » : l'action repart en traitement avec motif ; elle ne peut pas être clôturée.
  - [ ] Réouverture : permission dédiée, motif obligatoire, tracée.
  - [ ] Test exhaustif de la table des transitions ; action clôturée en lecture seule.
  - [ ] Condition proposée (à valider, D-05) : un incident ne peut être clôturé tant qu'une de ses actions critiques est ouverte, si la règle du site l'exige.
  - [ ] **CC-1, CC-2, CC-3 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-08 — Matrices de risques configurables et versionnées

- **Objectif.** Un administrateur QHSE définit la matrice de risques de son tenant ou d'un site, et la fait évoluer par versions.
- **Dépendances.** P2-02. Décision : D-10 (contenu « DÉMO »).
- **Contenu.** Tables : matrice, versions, échelles de probabilité et de gravité, niveaux de risque, seuils, mesures obligatoires par niveau ; états d'une version : `draft` → `published` → `retired` ; écran d'édition avec aperçu de la grille.
- **Critères d'acceptation.**
  - [ ] Une version publiée est immuable ; toute évolution crée une nouvelle version.
  - [ ] Une seule version publiée par matrice et par périmètre à un instant donné (contrainte en base).
  - [ ] Chaque case de la grille correspond à exactement un niveau (validation à la publication : ni trou, ni chevauchement).
  - [ ] Dimensions non figées : matrices 4 × 4 et 5 × 5 couvertes par des tests.
  - [ ] Résolution site → tenant testée ; une version utilisée par une évaluation ne peut pas être supprimée.
  - [ ] Jeu « DÉMO » étiqueté, installé par le seed de démonstration uniquement.
  - [ ] **CC-1, CC-2, CC-3 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-09 — Registre des risques : évaluations initiale et résiduelle

- **Objectif.** Enregistrer un danger, évaluer le risque initial, définir les mesures de maîtrise, évaluer le risque résiduel et conserver toutes les versions.
- **Dépendances.** P2-08.
- **Contenu.** Tables : risque (numéro, site, activité, danger, conséquences), évaluations versionnées (initiale et résiduelle, **référence de la version de matrice utilisée**), mesures de maîtrise ; écrans registre, fiche, historique. Les méthodes HAZID, HAZOP et Bow-Tie ne font pas partie de ce lot.
- **Critères d'acceptation.**
  - [ ] Le niveau de risque est calculé par le serveur à partir de la version de matrice ; une valeur envoyée par le client est ignorée.
  - [ ] Chaque évaluation conserve la référence de la version de matrice ; publier une nouvelle version ne modifie aucune évaluation existante (test).
  - [ ] Réévaluer crée une nouvelle version d'évaluation ; les précédentes restent consultables et immuables.
  - [ ] Si la matrice impose des mesures à un niveau donné, l'évaluation ne peut être validée sans au moins une mesure de maîtrise.
  - [ ] Une action peut être créée depuis un risque (source de type risque, via P2-06 si disponible ; sinon reporté et consigné).
  - [ ] **CC-1, CC-2, CC-3 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-10 — Modèles de checklists versionnés

- **Objectif.** Un responsable QHSE construit des modèles de checklist réutilisables.
- **Dépendances.** P2-02.
- **Contenu.** Tables : modèle, versions, sections, points de contrôle (types de réponse : conforme / non conforme / sans objet, valeur numérique, texte, photo requise) ; états d'une version : `draft` → `published` → `retired` ; écran de conception.
- **Critères d'acceptation.**
  - [ ] Version publiée immuable ; la modification passe par une nouvelle version.
  - [ ] Un modèle sans aucun point de contrôle ne peut pas être publié.
  - [ ] Libellés des points saisis par le client dans ses langues ; aucun contenu normatif livré.
  - [ ] Ordre des sections et des points stable et modifiable (test de réordonnancement).
  - [ ] **CC-1, CC-2, CC-3 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-11 — Inspections : planification, exécution, constats

- **Objectif.** Planifier une inspection, la réaliser sur tablette ou téléphone à partir d'un modèle, enregistrer les constats et en tirer des actions.
- **Dépendances.** P2-10, P2-06.
- **Contenu.** Tables : inspection (numéro, site, modèle et **version figée**, inspecteur, date prévue), réponses, constats ; états proposés : `planned` → `in_progress` → `completed` → `closed` ; `cancelled` (motif) ; écran d'exécution conçu d'abord pour le mobile (grandes cibles, enregistrement à chaque réponse).
- **Critères d'acceptation.**
  - [ ] L'inspection fige la version du modèle au démarrage ; une version publiée ensuite ne la modifie pas.
  - [ ] Elle ne peut être terminée que si tous les points obligatoires ont une réponse (et une photo quand elle est requise).
  - [ ] Un point « non conforme » crée un constat ; une action peut être créée depuis un constat (source de type constat).
  - [ ] Chaque réponse est enregistrée individuellement : recharger la page en cours d'inspection ne perd aucune réponse (vérifié dans l'application lancée).
  - [ ] Une inspection terminée est en lecture seule.
  - [ ] Statut « en retard » calculé par le serveur selon le fuseau du site.
  - [ ] **CC-1, CC-2, CC-3 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-12 — Heures travaillées

- **Objectif.** Saisir ou importer les heures travaillées par période, base de tous les taux.
- **Dépendances.** Phase 1 validée. Décision : **D-11 (bloquant)** — structure provisoire : entreprise × site × période × catégorie de population.
- **Contenu.** Table des heures ; saisie par période, import CSV avec rapport d'erreurs ; validation d'une période (verrouillage) ; écran de saisie.
- **Critères d'acceptation.**
  - [ ] Unicité par entreprise, site, période et catégorie : une seconde saisie corrige la première, sans doublon.
  - [ ] Valeurs négatives ou aberrantes refusées ; périodes futures refusées.
  - [ ] Import : tout ou rien, avec la liste des lignes en erreur ; rejouer le même fichier ne double rien.
  - [ ] Une période validée n'est modifiable qu'avec une permission dédiée et un motif, et la correction est tracée (CC-3).
  - [ ] Une période sans saisie est distinguée d'une période à zéro heure (nécessaire à la règle « non calculable »).
  - [ ] **CC-1, CC-2 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-13 — Moteur de KPI et dictionnaire en configuration

- **Objectif.** Calculer les indicateurs à partir de définitions versionnées, sans formule codée en dur.
- **Dépendances.** P2-12, P2-03. Décision : **D-11 (bloquant)**. `docs/KPI.md`.
- **Contenu.** Définitions de KPI en configuration par tenant (champs du dictionnaire) ; versions de définition ; service de calcul par période et périmètre ; endpoint de consultation ; écran « définitions des indicateurs ». Les KPI s'appuyant sur les CAPA et les inspections sont branchés quand P2-07 et P2-11 sont livrés.
- **Critères d'acceptation.**
  - [ ] Dénominateur absent **ou nul** : le résultat est « non calculable » avec sa raison, jamais `0` (tests des deux cas, API et écran).
  - [ ] Le facteur est lu dans la configuration du tenant : le même jeu de données donne des valeurs différentes pour 200 000 et 1 000 000 (test) ; aucun facteur n'apparaît dans le code.
  - [ ] Chaque résultat renvoie la version de définition, la période, le périmètre, le numérateur et le dénominateur utilisés.
  - [ ] Modifier une définition crée une version ; un calcul sur une période passée peut être refait avec la version alors en vigueur.
  - [ ] Le calcul respecte le périmètre de l'utilisateur : aucun incident ni aucune heure hors périmètre n'entre dans le résultat (test).
  - [ ] Résultats vérifiés sur des jeux de données calculés à la main, documentés dans les tests.
  - [ ] `docs/KPI.md` mis à jour avec les définitions réellement livrées, toujours présentées comme configuration validable.
  - [ ] **CC-1, CC-2 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-14 — Dashboard par rôle et périmètre

- **Objectif.** Chaque utilisateur voit, à la connexion, les indicateurs et les listes d'attention de son périmètre.
- **Dépendances.** P2-13, P2-07, P2-11. Décision : D-11.
- **Critères d'acceptation.**
  - [ ] Toute valeur affichée vient d'un endpoint ; aucune donnée fictive ni aucun graphique factice ; les données du seed portent la mention « DÉMO ».
  - [ ] Un KPI non calculable s'affiche « non calculable » avec sa raison, jamais 0 ni un graphique vide trompeur.
  - [ ] Le contenu dépend des permissions : un widget dont l'utilisateur n'a pas la permission n'est ni affiché ni chargé (test côté serveur).
  - [ ] Filtres de période et de site limités au périmètre de l'utilisateur.
  - [ ] Chaque indicateur affiche sa définition (formule, facteur, période) et mène à la liste des enregistrements sous-jacents.
  - [ ] Poids de la page et nombre de requêtes consignés ; chargement à la demande du module de graphiques ; dépendance de graphiques justifiée.
  - [ ] **CC-1, CC-2 et test de périmètre** pour chaque endpoint d'agrégat ; CC-4 à CC-7.

### P2-15 — Exports CSV et XLSX

- **Objectif.** Exporter les listes (incidents, actions, risques, inspections) avec les filtres en cours.
- **Dépendances.** P2-03, P2-07 (étendu aux autres listes dès leur livraison).
- **Critères d'acceptation.**
  - [ ] L'export contient exactement les lignes que l'utilisateur peut lister avec ces filtres : ni plus (périmètre), ni moins.
  - [ ] Permission `…:export` distincte de la lecture ; chaque export est tracé (qui, quoi, filtres, nombre de lignes) (CC-3).
  - [ ] Cellules commençant par `=`, `+`, `-` ou `@` neutralisées (test d'injection de formule).
  - [ ] Volume maximal imposé par le serveur ; au-delà, refus explicite plutôt que troncature silencieuse.
  - [ ] En-têtes de colonnes dans la langue de l'utilisateur ; dates avec fuseau explicite.
  - [ ] Dépendance XLSX justifiée (licence, maintenance, poids).
  - [ ] **CC-1, CC-2 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-16 — Exports PDF

- **Objectif.** Produire la fiche d'incident, le rapport d'enquête et la fiche d'action en PDF.
- **Dépendances.** P2-05, P2-07.
- **Critères d'acceptation.**
  - [ ] Génération côté serveur, sans service externe ; fonctionne dans l'image Docker (testé dans le conteneur, pas seulement sur le poste de développement).
  - [ ] Le PDF porte le numéro du dossier, la date et l'auteur de la génération, le statut du dossier à cet instant, et la mention « DÉMO » pour les données de démonstration.
  - [ ] Aucune mention de certification ni de garantie de conformité.
  - [ ] Contenu en FR ou EN selon l'utilisateur ; caractères accentués correctement rendus (test).
  - [ ] Génération tracée (CC-3) ; **CC-1, CC-2 et test de périmètre** pour chaque endpoint ; CC-4 à CC-7.

### P2-17 — Notifications d'affectation et d'échéance (à confirmer)

- **Avertissement de périmètre.** Ce lot **ne figure pas** dans la liste de la Phase 2 du prompt maître. Il est proposé parce qu'un suivi d'actions sans rappel perd beaucoup de son intérêt ; il n'est réalisé que sur validation explicite. S'il est écarté, il est reporté en Phase 3.
- **Objectif.** Prévenir le responsable d'une action à l'affectation et à l'approche de l'échéance, par e-mail et dans l'application.
- **Dépendances.** P2-07. Décision : **D-03 (bloquant)**.
- **Critères d'acceptation (sous réserve de validation).**
  - [ ] Préférences de notification par utilisateur ; aucun envoi à un compte désactivé.
  - [ ] Un rappel n'est jamais envoyé deux fois pour la même échéance (idempotence du traitement planifié).
  - [ ] Le contenu de l'e-mail ne contient aucune donnée sensible : un lien vers l'application, soumis à l'authentification.
  - [ ] Si un planificateur ou une file d'attente (Redis + BullMQ) est introduit, un ADR le justifie.
  - [ ] **CC-1 et CC-2** pour chaque endpoint ; CC-3 à CC-7.

### P2-18 — Clôture de la Phase 2

- **Objectif.** Démontrer le critère de sortie et obtenir la validation humaine.
- **Dépendances.** Tous les lots P2 (hors P2-17 s'il est écarté).
- **Critères d'acceptation.**
  - [ ] Test E2E automatisé : déclaration d'un incident → qualification → enquête approuvée → action critique créée → preuve → vérification par une **autre** personne → clôture de l'action → clôture de l'incident.
  - [ ] Le même test vérifie, à chaque étape, qu'un rôle insuffisant est refusé et que le journal d'audit contient la transition (acteur, statuts, motif).
  - [ ] Le même scénario, rejoué par un utilisateur d'un autre tenant et par un utilisateur d'un autre site, n'accède à rien.
  - [ ] Revue d'isolation et de permission mise à jour pour tous les endpoints de la phase.
  - [ ] Relecture des workflows par un praticien QHSE consignée (ou son absence écrite comme risque).
  - [ ] Rapport de phase ; **arrêt et attente de validation** avant la Phase 3.

---

# Phases 3 à 7 — gros grain (non détaillées)

Ces phases **ne sont pas découpées en lots**. Elles le seront à leur ouverture, après validation de la phase précédente. Leur ordre peut changer selon D-04.

### Phase 3 — Opérations industrielles

- Permis de travail (machine à états complète, conditions d'activation vérifiées par le serveur, expiration calculée par le serveur), JSA/JHA, consignation LOTO, coactivité.
- Audits et registre de conformité (référentiels et versions de normes en données ; aucune reproduction de texte normatif).
- Formations et habilitations ; EPI ; sous-traitants et préqualification ; gestion documentaire avancée (circuit de validation, diffusion).
- **Critère de sortie :** un permis ne peut pas être activé si une condition configurée manque, prouvé par les tests de la machine à états.
- Points durs prévisibles : données médicales d'aptitude séparées des données opérationnelles ; entités « projet » et « contrat » pour les périmètres ; détail des heures par sous-traitant (D-11).

### Phase 4 — Environnement et équipements

- Déchets, déversements, émissions, rejets, consommations.
- Équipements critiques, inspections, étalonnages, maintenance HSE ; QR codes et traçabilité.

### Phase 5 — Mobile et offline

- Application Android (React Native), SQLite chiffré, file d'attente locale, photo, QR, formulaires, pièces jointes différées, synchronisation, conflits, reprise.
- ADR préalables : stockage des jetons sur mobile, protocole de synchronisation, règles de résolution de conflits par type de donnée.
- **Critère de sortie :** tests en réseau dégradé (coupure pendant l'envoi, rejeu d'événements, conflit sur donnée sensible) sans perte ni doublon.
- Dépend de D-07.

### Phase 6 — Offshore

- Installations et navires, POB, embarquement et débarquement, Muster List et exercices, MEDEVAC, plans d'urgence.
- Validation obligatoire avec des responsables opérationnels.

### Phase 7 — Industrialisation

- Tests de sécurité et de charge, pentest et corrections ; sauvegarde, restauration testée, PRA ; observabilité.
- Packaging SaaS, on-premise et hybride ; licence (D-08) ; synchronisation serveur de site ↔ cloud si retenue (D-07, ADR dédié obligatoire avant tout code) ; purge et archivage (D-06) ; hébergement (D-01) ; préparation du pilote.

---

# Points à clarifier relevés pendant le cadrage

Ambiguïtés du prompt maître traitées par une hypothèse dans ce backlog ; à confirmer lors de la validation du cadrage.

1. **Périmètres « projet » et « contrat ».** Le RBAC doit gérer ces périmètres (4.3), mais la Phase 1 ne cite que tenants, entreprises, sites et départements. Hypothèse : P1-07 rend le type de périmètre extensible sans créer ces entités ; elles arrivent avec le premier module qui en a besoin (Phase 3).
2. **Heures « par sous-traitant ».** Exigées pour les KPI de la Phase 2 (5.4), alors que le module Sous-traitants est en Phase 3. Traité par D-11.
3. **Notifications.** Citées dans la stack et dans les décisions à ouvrir, mais absentes de la liste des phases. Traité par le lot P2-17, soumis à validation.
4. **Tranche verticale et lots de fondation.** Un lot est défini comme migration + API + écran (section 7) ; P1-01 à P1-03 n'ont pas d'écran, faute d'objet utilisateur. Écart assumé et signalé.
5. **Identification du tenant à la connexion** et **opérateur de plateforme** : non décrits. Traités par D-12 et D-13.
6. **Gestion documentaire** : « de base » en Phase 1 et « avancée » en Phase 3, sans frontière écrite. Hypothèse : Phase 1 = dépôt sécurisé, versions, numérotation ; Phase 3 = circuit de validation et diffusion.
