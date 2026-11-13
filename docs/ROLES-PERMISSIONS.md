# Rôles et permissions — QHSE MANAGER

État au lot P1-05. Ce document décrit ce qui est **réellement implémenté** ; il est mis à jour par chaque lot qui ajoute une permission.

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

## Portée

À ce stade un rôle s'applique à **toute l'entreprise**. Les périmètres plus fins (site, département, projet, contrat) arrivent avec le lot P1-07.

## Séparation des tâches

Les règles de séparation des tâches (pas d'auto-approbation, vérificateur de CAPA différent du responsable…) sont portées par les machines à états de chaque module, à partir de la Phase 2. Elles ne sont pas encore implémentées. Règle non désactivable prévue : la vérification d'efficacité d'une CAPA est faite par une autre personne que le responsable de l'action.

## Ajouter une permission (pour les développeurs)

1. Ajouter la clé dans `PERMISSIONS` et dans `PERMISSION_GROUPS` (`packages/shared/src/permissions.ts`).
2. Ajouter son libellé FR et EN (`access.permissions.*`) et l'entrée de `PERMISSION_LABELS` (`apps/web/src/features/access/labels.ts`) — la compilation échoue sinon.
3. Déclarer `@RequirePermission(...)` sur les routes concernées.
4. Écrire les tests CC-1 et CC-2 avec le harnais (`docs/CONTRIBUTING.md`).
5. Mettre à jour le tableau ci-dessus et, si besoin, les rôles de référence.
