# ADR 0004 — Identifiants, numérotation métier, idempotence et version d'enregistrement

- **Statut :** Accepté pour les principes (imposés par le prompt maître, sections 4.4 et 6) ; les détails de mise en œuvre marqués « à vérifier » sont confirmés dans le lot **P1-12**.
- **Date :** 2026-11-13.

## Contexte

Les enregistrements doivent pouvoir être créés hors ligne (mobile en Phase 5, serveur de site plus tard) puis envoyés au serveur sans doublon, même si l'envoi est rejoué après une coupure. Les utilisateurs ont par ailleurs besoin de numéros courts et lisibles (rapports, radio, téléphone). Le prompt maître exige que ces fondations existent dès la Phase 1.

## Décision

### 1. Clés primaires : UUID v7

- Toute table métier a une clé primaire `id uuid`. La version 7 (ordonnée dans le temps) est préférée pour la localité des index.
- **Génération par l'application**, pas par la base : l'image PostgreSQL 16 utilisée en développement ne fournit pas de fonction native de génération d'UUID v7. Le choix du générateur (bibliothèque ou fonction interne) est fait dans P1-12, avec la justification de dépendance habituelle.
- **Le client peut fournir l'`id` à la création.** Le serveur vérifie qu'il s'agit d'un UUID bien formé ; s'il est absent, le serveur le génère. L'acceptation d'UUID v4 venant de clients plus anciens est tranchée dans P1-12.
- Un `id` fourni par un client n'est qu'un identifiant : il ne donne aucun droit et le serveur ne lui fait pas confiance pour dater ou ordonner. **Aucun tri métier ne repose sur l'`id`** ; l'ordre chronologique fait foi sur `created_at` (heure serveur).
- Collision d'`id` : si l'`id` existe déjà dans le même tenant avec un contenu identique, c'est un rejeu (voir § 3) ; avec un contenu différent, la réponse est `CONFLICT`. Si l'`id` existe dans un autre tenant, la contrainte d'unicité échoue en base : la réponse doit être indiscernable d'un conflit ordinaire et ne rien révéler de l'autre tenant — **cas à couvrir par un test dans P1-12**.
- Limite connue : un UUID v7 révèle l'instant approximatif de sa création. Jugé acceptable ; les identifiants ne sont pas des secrets et l'accès reste soumis aux permissions.

### 2. Numéros métier lisibles

- Distincts de la clé primaire, **attribués par le serveur uniquement**, séquentiels par tenant et par type d'objet (ex. `INC-2026-000042`). Le format (préfixe, présence de l'année, remise à zéro annuelle, longueur) est une configuration du tenant.
- Mise en œuvre : une table de compteurs par `(tenant_id, clé de séquence)`, incrémentée par une mise à jour avec verrou de ligne **dans la transaction qui crée l'enregistrement**.
  - Avantage : pas de trou en cas d'annulation de la transaction.
  - Coût : les créations d'un même type dans un même tenant sont sérialisées pendant la durée de la transaction. Acceptable aux volumes attendus ; à mesurer dans P1-12.
  - Les séquences natives de PostgreSQL ne sont pas retenues : elles ne sont pas par tenant et laissent des trous.
- Contrainte `UNIQUE (tenant_id, number)` sur chaque table numérotée.
- **Hors ligne**, un enregistrement n'a pas de numéro tant qu'il n'est pas synchronisé : l'interface affiche une référence locale provisoire clairement distincte, remplacée par le numéro officiel à la synchronisation. Le numéro reflète donc l'ordre de réception par le serveur, pas l'ordre de saisie sur le terrain.
- Un numéro attribué n'est jamais réutilisé ni modifié, même si le dossier est archivé.

### 3. Idempotence des écritures

- Toute requête de création, et toute requête déclenchant une transition d'état, accepte un en-tête `Idempotency-Key` (valeur opaque générée par le client).
- Le serveur enregistre, dans la même transaction que l'écriture : tenant, utilisateur, clé, empreinte de la requête, résultat.
  - Même clé et même empreinte : le résultat initial est renvoyé, rien n'est rejoué.
  - Même clé, empreinte différente : `CONFLICT`.
- Les clés sont uniques par tenant ; elles sont conservées pendant une durée limitée. Cette durée devra couvrir la plus longue période hors ligne admise : valeur fixée en Phase 5 (lien avec D-07) ; valeur de départ prudente choisie dans P1-12.
- Caractère obligatoire ou facultatif de l'en-tête pour le client web : tranché dans P1-12 (proposition : obligatoire pour les créations).
- Limite : la clé protège contre le rejeu d'une même requête, pas contre une double saisie volontaire de deux dossiers semblables.

### 4. Colonnes techniques communes à toute table métier

| Colonne                         | Rôle                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`                            | UUID v7 (§ 1).                                                                                    |
| `tenant_id`                     | Isolation (ADR 0002).                                                                             |
| `created_at`, `updated_at`      | Heure **serveur**, UTC.                                                                           |
| `created_by`, `updated_by`      | Utilisateur de la session.                                                                        |
| `client_created_at` (optionnel) | Heure locale déclarée par l'appareil, conservée à titre d'information ; l'heure serveur fait foi. |
| `version`                       | Entier incrémenté à chaque modification ; contrôle de concurrence optimiste.                      |
| `archived_at`, `archived_by`    | Archivage logique ; aucune suppression physique d'un dossier auditable.                           |

- Une modification envoie la `version` lue ; si elle ne correspond plus, le serveur répond `CONFLICT` sans écraser. Pour les objets sensibles, aucune résolution automatique : arbitrage humain (prompt maître, section 6).
- Ces colonnes ne sont ajoutées qu'aux tables réellement créées par un lot ; aucune table n'est créée par anticipation.

## Alternatives envisagées

| Alternative                                        | Raison du rejet                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Entiers auto-incrémentés                           | Impossibles à générer hors ligne ; révèlent les volumes.                                           |
| UUID v4 partout                                    | Fonctionne, mais insertions dispersées dans les index ; reste toléré en entrée si P1-12 le décide. |
| Numéro métier utilisé comme clé primaire           | Inconnu hors ligne ; changerait à la synchronisation.                                              |
| Numéro généré par le client (préfixe par appareil) | Numéros peu lisibles et non séquentiels ; contraire au prompt maître.                              |
| Idempotence fondée uniquement sur l'`id` fourni    | Ne couvre pas les transitions d'état.                                                              |
| Séquence PostgreSQL par tenant                     | Un objet de base par tenant et par type, à créer dynamiquement ; trous en cas d'annulation.        |

## Conséquences

- **Positif :** création hors ligne sans coordination ; rejeu sans doublon ; numéros stables et lisibles ; conflits de modification détectés.
- **Coûts et limites assumés :** une table de clés d'idempotence à purger ; créations sérialisées par compteur ; écart possible entre ordre de saisie et ordre des numéros ; chaque client doit gérer la `version` et la clé d'idempotence, ce qui alourdit légèrement les formulaires du web dès la Phase 1.
