# ADR 0005 — Journal d'audit en ajout seul

- **Statut :** Accepté — mis en œuvre et vérifié par le lot **P1-03** (voir « Résultats du lot P1-03 »). La purge et l'archivage dépendent de **D-06**.
- **Date :** 2026-11-13.

## Contexte

Les dossiers QHSE servent de preuve lors des enquêtes, des audits et des litiges. Il faut pouvoir établir qui a fait quoi, quand, et dans quel état se trouvait le dossier. Le prompt maître exige un journal que l'application ne peut ni modifier ni supprimer, et l'enregistrement systématique de chaque transition d'état.

## Décision

### 1. Une table unique, écrite dans la transaction métier

- Table `audit_events`, portant `tenant_id` et soumise à la RLS (ADR 0002).
- L'événement est inséré **dans la même transaction** que la modification qu'il décrit : pas de modification sans trace, pas de trace sans modification.
- Les modules métier n'écrivent pas directement dans la table : ils passent par le service du module `audit`, seul à en connaître la structure.

### 2. Contenu d'un événement

| Champ                                | Contenu                                                                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                                 | UUID v7.                                                                                                                     |
| `tenant_id`                          | Tenant de la session.                                                                                                        |
| `occurred_at`                        | **Heure serveur** (UTC), fixée par la base.                                                                                  |
| `actor_user_id`                      | Utilisateur de la session ; vide pour une action du système, avec `actor_type` (`user`, `system`).                           |
| `action`                             | Clé stable en anglais, ex. `incident.status_changed`, `auth.login_succeeded`, `role.permission_granted`, `export.generated`. |
| `resource_type`, `resource_id`       | Objet concerné.                                                                                                              |
| `from_status`, `to_status`, `reason` | Pour une transition d'état : statut précédent, nouveau statut, motif.                                                        |
| `metadata`                           | Données structurées complémentaires, sans secret ni donnée médicale.                                                         |
| `request_id`, `session_id`           | Corrélation avec les journaux techniques et la session.                                                                      |
| `ip_address`, `user_agent`           | Contexte de la requête, quand il existe.                                                                                     |
| `client_occurred_at`, `device_id`    | Pour une action faite hors ligne et synchronisée (à partir de la Phase 5).                                                   |

- **Toute transition d'état** enregistre obligatoirement : acteur, date serveur, statut précédent, nouveau statut, motif. Le motif est exigé par la machine à états pour les transitions qui le demandent (rejet, réouverture, annulation).
- Actions tracées au minimum : connexion et déconnexion, échec de connexion sur un compte connu, changement de droits, approbation, rejet, clôture, réouverture, export, archivage logique, synchronisation.
- Le journal décrit l'action ; il ne recopie pas le contenu complet des dossiers. L'historique des valeurs d'un dossier relève de son versionnement propre (ex. versions d'évaluation de risque), pas du journal.

### 3. Ajout seul, garanti autant que possible par la base

Par ordre de mise en place dans P1-03 :

1. Le rôle PostgreSQL d'exécution de l'API ne reçoit sur `audit_events` que les privilèges `INSERT` et `SELECT` ; `UPDATE`, `DELETE` et `TRUNCATE` ne lui sont pas accordés.
2. Les politiques RLS n'existent que pour `INSERT` et `SELECT`.
3. Un déclencheur refuse tout `UPDATE` et tout `DELETE` par une erreur : seconde barrière en cas d'erreur d'attribution de privilèges.
4. Des tests d'intégration tentent ces opérations avec le rôle d'exécution et vérifient le refus.
5. L'application n'expose aucune route de modification ou de suppression du journal.

**Limite assumée, à dire clairement aux clients :** ces mesures empêchent l'application, y compris compromise au niveau applicatif, d'altérer le journal. Elles **n'empêchent pas** le propriétaire du schéma, un superutilisateur ou un administrateur de la base de le faire. Le journal n'est donc pas « infalsifiable ». Renforcements possibles, **non retenus à ce stade** et à étudier en Phase 7 : chaînage par empreintes des événements (détecte une altération, mais sérialise les écritures par tenant) ; export périodique signé vers un stockage à écriture unique.

### 4. Consultation

- Lecture réservée à la permission `audit-log:read`, toujours filtrée par tenant, paginée, triée par `occurred_at`, filtrable par objet, acteur, action et période.
- La consultation et l'export du journal sont eux-mêmes des actions tracées.

### 5. Conservation

- Aucune purge tant que D-06 n'est pas tranchée.
- La table est conçue pour être partitionnée par période, afin qu'un archivage à froid ou une purge réglementaire se fasse par partition, au moyen d'une opération de maintenance hors application exécutée avec un rôle distinct et consignée. Le partitionnement déclaratif n'étant pas décrit nativement par le schéma Prisma, sa mise en œuvre par migration SQL et sa cohabitation avec Prisma sont **à vérifier dans P1-03** ; à défaut, la table reste simple et le partitionnement est reporté, avec la dette consignée.

## Résultats du lot P1-03

Vérifié par `apps/api/test/audit-log.e2e-spec.ts` (PostgreSQL 16, Prisma 7.10).

- **Ajout seul, deux barrières prouvées :** le rôle d'exécution ne détient que `INSERT` et `SELECT` (`UPDATE`, `DELETE`, `TRUNCATE` refusés) ; un déclencheur refuse en plus `UPDATE`, `DELETE` et `TRUNCATE` **y compris au propriétaire de la table**. Les privilèges sont retirés dans la migration à tous les bénéficiaires, sans y écrire de nom de rôle.
- **Écart par rapport au § 3.2 :** la table garde la politique RLS unique `tenant_isolation` (toutes commandes) commune à toutes les tables à portée tenant, au lieu de politiques limitées à `INSERT` et `SELECT`. Raison : le test de catalogue exige la même politique partout, ce qui empêche d'oublier une table. Les deux barrières ci-dessus couvrent la modification et la suppression.
- **Heure serveur :** un déclencheur fixe `occurred_at` avec l'horloge de la base à l'insertion ; une valeur fournie est ignorée, y compris en SQL direct. Le service n'accepte aucune date en entrée.
- **Atomicité :** l'événement s'écrit avec la transaction de l'unité de travail (`AuditService.record(tx, …)`). Prouvé dans les deux sens : transaction métier annulée → aucun événement ; événement refusé (par le service ou par la base) → modification métier annulée.
- **Acteur :** utilisateur du contexte, ou « système » déclaré explicitement. Aucun événement anonyme. L'acteur est lié par clé étrangère composite : il appartient forcément au même tenant.
- **Transitions :** statut précédent et nouveau statut obligatoires ensemble (service et contrainte de base). Le caractère obligatoire du motif dépend de la transition : il sera imposé par chaque machine à états.
- **Métadonnées :** objet JSON de 8 ko au plus ; les clés évoquant un secret (mot de passe, jeton, clé d'API, code MFA…) sont refusées. Ce filtre repose sur les noms de clés : il réduit le risque, il ne remplace pas la revue.
- **Colonnes reportées :** `client_occurred_at` et `device_id` seront ajoutées en Phase 5 avec la synchronisation hors ligne.
- **Partitionnement — faisable, reporté.** Essai réalisé sur une copie : table partitionnée par intervalle sur `occurred_at`, clé primaire `(id, occurred_at)`, partition par défaut ; `prisma migrate dev` ne détecte ensuite aucune dérive. Non mis en place maintenant, car la granularité dépend de D-06 et qu'aucun outil ne crée encore les partitions périodiques : tout irait dans la partition par défaut, sans bénéfice. **Dette consignée :** convertir la table (nouvelle table partitionnée, copie, bascule, clé primaire élargie) avant le premier pilote à fort volume, au plus tard en Phase 7.
- **Limite inchangée :** le propriétaire du schéma peut désactiver les déclencheurs (c'est ce que fait le nettoyage des bases de test). Le journal n'est pas « infalsifiable » vis-à-vis d'un administrateur de la base.

## Alternatives envisagées

| Alternative                                     | Raison du rejet ou du report                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Écriture asynchrone du journal (file d'attente) | Risque de perdre une trace si le traitement échoue après la validation de la transaction ; introduirait Redis sans besoin réel.                        |
| Journaux applicatifs (fichiers) seuls           | Ni interrogeables par le client, ni liés transactionnellement aux données. Ils restent utiles en complément technique.                                 |
| Déclencheurs génériques sur toutes les tables   | Capturent des changements de colonnes, pas l'intention métier (motif, transition) ; l'acteur n'est pas connu de la base sans mécanisme supplémentaire. |
| Architecture « event sourcing » complète        | Disproportionnée ; complexifie chaque module.                                                                                                          |
| Chaînage par empreintes dès maintenant          | Contention sur les écritures ; valeur limitée tant que l'exploitation n'est pas définie. Reporté.                                                      |

## Conséquences

- **Positif :** traçabilité cohérente avec les données ; modèle unique pour tous les modules ; refus d'altération vérifié par des tests.
- **Coûts et limites assumés :** une insertion supplémentaire par action sensible ; table à forte croissance (index et partitionnement à soigner) ; garantie d'intégrité limitée face à un administrateur de base de données ; les échecs de connexion non rattachables à un tenant ne figurent pas dans le journal d'audit mais dans les journaux techniques.
