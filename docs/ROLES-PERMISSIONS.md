# Rôles et permissions — QHSE MANAGER

État au lot P1-07. Ce document décrit ce qui est **réellement implémenté** ; il est mis à jour par chaque lot qui ajoute une permission.

## Principes

- **Les permissions sont du code, les rôles sont des données.** Le catalogue des permissions est défini dans `packages/shared/src/permissions.ts`. Chaque entreprise compose ses rôles — un par poste — à partir de ce catalogue.
- **Refus par défaut.** Une route de l'API est soit publique (`@Public()`), soit ouverte à tout utilisateur connecté (`@AuthenticatedOnly()`), soit protégée par une permission (`@RequirePermission(...)`). Une route qui ne déclare rien répond `403` à tout le monde. Deux tests fixent la liste exacte des routes publiques et des routes ouvertes à tout utilisateur connecté.
- **Évaluation à chaque requête.** Les permissions sont relues en base à chaque requête : l'attribution ou le retrait d'un rôle prend effet immédiatement, sans reconnexion. Elles ne sont jamais inscrites dans le jeton d'accès.
- **Le serveur seul décide.** Le web masque les menus et les boutons que l'utilisateur ne peut pas utiliser ; c'est une aide, pas un contrôle.

## Catalogue des permissions

| Clé              | Ce qu'elle autorise                           | Routes                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------ |
| `role:read`      | Consulter les rôles et leurs droits           | `GET /roles`, `GET /roles/:id`                         |
| `role:manage`    | Créer, modifier, supprimer un rôle            | `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` |
| `role:assign`    | Attribuer ou retirer un rôle à un utilisateur | `PUT` et `DELETE /users/:userId/roles/:roleId`         |
| `user:read`      | Consulter les utilisateurs et leurs rôles     | `GET /users`                                           |
| `audit-log:read` | Consulter le journal d'audit                  | `GET /audit-events`                                    |

Convention de nommage : `ressource:action`, en minuscules. Une permission n'est ajoutée au catalogue que lorsqu'une fonctionnalité livrée la vérifie.

Route ouverte à tout utilisateur connecté : `GET /auth/me` (sa propre identité et ses permissions).

## Rôles installés avec chaque entreprise (décision D-05)

| Rôle             | Clé             | Permissions                                 | Modifiable                         |
| ---------------- | --------------- | ------------------------------------------- | ---------------------------------- |
| Administrateur   | `administrator` | Toutes, y compris celles ajoutées plus tard | Non (ni modifiable ni supprimable) |
| Responsable QHSE | `qhse-manager`  | `role:read`, `user:read`, `audit-log:read`  | Oui                                |
| Auditeur         | `auditor`       | `audit-log:read`                            | Oui                                |

L'administrateur crée ensuite les rôles de chaque poste (chef de quart, magasinier, superviseur…) et les attribue. Les rôles de référence des métiers QHSE recevront leurs permissions au fur et à mesure de la livraison des modules ; aucun rôle « vide pour plus tard » n'est installé.

Le premier administrateur d'une entreprise est créé par la commande serveur `pnpm user:create … --administrator`.

## Règles contre l'élévation de privilèges

Vérifiées par `apps/api/test/rbac.e2e-spec.ts`.

1. Personne ne peut s'attribuer un rôle à soi-même, pas même un administrateur.
2. On ne peut créer, modifier, supprimer, attribuer ou retirer qu'un rôle dont on détient soi-même **toutes** les permissions.
3. Le rôle Administrateur ne peut être ni modifié ni supprimé.
4. Une entreprise garde toujours au moins un administrateur **actif** : le retrait du dernier est refusé.
5. Un rôle encore attribué ne peut pas être supprimé.
6. Deux modifications simultanées d'un même rôle ne s'écrasent pas : la seconde est refusée (`CONFLICT`) et doit recharger.
7. Rôles et utilisateurs de deux entreprises différentes ne peuvent pas être combinés : la réponse est celle d'un élément inexistant (`404`).

Tout changement de droits est inscrit au journal d'audit : `role.created`, `role.updated`, `role.deleted`, `role.assigned`, `role.unassigned`. La consultation du journal l'est aussi (`audit_log.viewed`, une fois par consultation).

## Rôles de référence et entreprises déjà créées

Les rôles de référence sont installés à la création d'une entreprise. Une permission ajoutée ensuite à un rôle de référence (ici `organization:read` pour le Responsable QHSE) ne s'applique qu'aux entreprises créées après ; pour les autres, l'administrateur l'ajoute au rôle depuis l'écran Rôles. L'Administrateur, lui, détient toujours tout le catalogue.

## Périmètres (lot P1-07, ADR 0007)

Un rôle s'attribue sur un périmètre : **toute l'organisation, une entreprise, un site ou un département**. Plusieurs attributions se cumulent.

| Périmètre de l'attribution | Ce qu'il couvre                             |
| -------------------------- | ------------------------------------------- |
| Toute l'organisation       | Tout                                        |
| Une entreprise             | L'entreprise, ses sites, leurs départements |
| Un site                    | Le site et ses départements                 |
| Un département             | Ce département seulement                    |

Un périmètre ne donne jamais accès à ce qui le contient. Ce qui est hors périmètre est invisible : absent des listes, et `404` en accès direct.

| Permission                                                | Peut être limitée à un périmètre ?                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `organization:read`, `organization:manage`                | Oui. Créer une entreprise demande le droit sur toute l'organisation. |
| `role:assign`                                             | Oui : on n'attribue des rôles que dans son propre périmètre.         |
| `role:read`, `role:manage`, `user:read`, `audit-log:read` | Non : elles n'ont d'effet qu'attribuées sur toute l'organisation.    |

Routes d'attribution : `POST /users/:userId/role-assignments` (`{ roleId, scopeType, scopeId }`) et `DELETE /users/:userId/role-assignments/:assignmentId`.

Règles supplémentaires :

- on n'attribue un rôle que si l'on détient **sur ce périmètre** toutes ses permissions ;
- le rôle Administrateur attribué sur un site donne tous les droits **limitables** sur ce site, pas l'administration de l'organisation ;
- `GET /auth/me` distingue `permissions` (sur toute l'organisation) et `permissionsAnywhere` (sur au moins un périmètre).

## Séparation des tâches

Les règles de séparation des tâches (pas d'auto-approbation, vérificateur de CAPA différent du responsable…) sont portées par les machines à états de chaque module, à partir de la Phase 2. Elles ne sont pas encore implémentées. Règle non désactivable prévue : la vérification d'efficacité d'une CAPA est faite par une autre personne que le responsable de l'action.

## Ajouter une permission (pour les développeurs)

1. Ajouter la clé dans `PERMISSIONS` et dans `PERMISSION_GROUPS` (`packages/shared/src/permissions.ts`).
2. Ajouter son libellé FR et EN (`access.permissions.*`) et l'entrée de `PERMISSION_LABELS` (`apps/web/src/features/access/labels.ts`) — la compilation échoue sinon.
3. Déclarer `@RequirePermission(...)` sur les routes concernées.
4. Écrire les tests CC-1 et CC-2 avec le harnais (`docs/CONTRIBUTING.md`).
5. Mettre à jour le tableau ci-dessus et, si besoin, les rôles de référence.
