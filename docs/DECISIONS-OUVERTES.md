# Décisions ouvertes — QHSE MANAGER

Questions qui attendent une réponse **humaine**. Tant qu'une décision n'est pas tranchée, le développement applique l'« hypothèse provisoire » indiquée (quand il en existe une qui soit sûre et réversible) et les lots listés dans « Bloque » restent bloqués ou partiellement bloqués.

Une fois tranchée, la décision est déplacée dans la section « Décisions tranchées » en bas de ce fichier (date, décideur, choix) et, si elle est technique, consignée dans un ADR.

Dernière mise à jour : 2026-11-13 (Phase 0).

## Vue d'ensemble

| ID   | Sujet                                                                | Bloque (lots)                                   | Urgence                   |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------- | ------------------------- |
| D-01 | Hébergement, localisation des données, lois nationales               | P1-13 (partiel), Phase 7, tout pilote réel      | Avant le pilote           |
| D-02 | Modèle d'isolation SaaS et attentes on-premise                       | P1-02                                           | **Avant la Phase 1**      |
| D-03 | Fournisseur e-mail/SMS et canaux de notification terrain             | P1-08 (partiel), P2-16                          | Avant P1-08 en production |
| D-04 | Client pilote, secteur, modules indispensables                       | Priorisation de la Phase 2 et des phases 3 à 6  | Avant la Phase 2          |
| D-05 | Rôles métier de référence et séparation des tâches                   | P1-05 (partiel), P2-02, P2-04, P2-06            | Avant P1-05               |
| D-06 | Durées de conservation (dossiers, journal d'audit)                   | P1-03 (partiel), P1-14 (partiel), Phase 7       | Avant le pilote           |
| D-07 | Synchronisation serveur de site ↔ cloud : périmètre et calendrier    | Aucun lot des phases 1-2 ; Phase 5 et suivantes | Avant la Phase 5          |
| D-08 | Licence et activation on-premise                                     | Phase 7 (packaging)                             | Avant la Phase 7          |
| D-09 | Méthodes MFA utilisables en faible connectivité                      | P1-09                                           | Avant P1-09               |
| D-10 | Classification des incidents et matrice de risques « DÉMO »          | P2-01 (partiel), P2-07 (partiel)                | Avant la Phase 2          |
| D-11 | Définitions KPI de référence et source des heures travaillées        | P2-11, P2-12, P2-13                             | Avant P2-11               |
| D-12 | Identité des utilisateurs et identification du tenant à la connexion | P1-02 (partiel), P1-04                          | **Avant la Phase 1**      |
| D-13 | Provisionnement des tenants et rôle « opérateur de plateforme »      | P1-02 (partiel)                                 | Avant P1-02               |

---

## D-01 — Hébergement, localisation des données et lois nationales de protection des données

**Question.** Où les données des clients SaaS sont-elles hébergées (pays, fournisseur), et quelles obligations légales de protection des données personnelles s'appliquent dans chaque pays visé (République du Congo, Gabon, Cameroun, RDC) : localisation, transfert hors du pays, déclaration ou autorisation auprès d'une autorité, durée de conservation, droits des personnes, traitement des données de santé ?

**Pourquoi c'est important.** La plateforme traitera des données personnelles (identité, affectations, habilitations) et, à terme, des données sensibles (accidents du travail, aptitude médicale). Le choix d'hébergement conditionne l'offre commerciale, le contrat, l'architecture de déploiement et la possibilité même de servir certains clients en SaaS.

**Avertissement.** Ce document **n'affirme aucune exigence légale**. Les cadres nationaux diffèrent d'un pays à l'autre et évoluent ; leur contenu, leur applicabilité à notre cas (éditeur, sous-traitant de traitement, hébergeur tiers) et les formalités éventuelles **doivent être établis et validés par un conseil juridique local dans chaque pays** avant tout traitement de données réelles. Points à faire vérifier par ce conseil, pays par pays :

- existence et portée d'un texte sur la protection des données personnelles, autorité compétente, formalités préalables ;
- règles sur l'hébergement ou le transfert des données hors du territoire ;
- régime des données de santé et des données relatives aux accidents du travail ;
- obligations sectorielles (pétrole et gaz, maritime) et clauses habituelles des donneurs d'ordre ;
- durées de conservation imposées (lien avec D-06).

**Options.**

| Option                                                                                                              | Conséquences                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. SaaS hébergé dans une région cloud unique hors Afrique centrale (ex. Europe)                                     | Simple à exploiter, latence plus élevée, peut être incompatible avec des exigences de localisation ou avec les politiques de certains clients — à vérifier.              |
| B. SaaS hébergé chez un fournisseur présent sur le continent (région cloud africaine ou centre de données régional) | Meilleure latence et argument commercial ; offre de services et fiabilité à évaluer ; conformité toujours à valider pays par pays.                                       |
| C. Une instance SaaS par pays ou par zone                                                                           | Répond à une éventuelle obligation de localisation ; coût d'exploitation multiplié ; nécessite un packaging de déploiement reproductible (déjà exigé pour l'on-premise). |
| D. On-premise uniquement pour les clients soumis à contrainte de localisation, SaaS pour les autres                 | Aucun développement spécifique (même code) ; déplace la charge d'exploitation chez le client.                                                                            |

**Recommandation.** Ne rien figer avant l'avis juridique. Techniquement, garder l'architecture indifférente à la région (aucun service cloud propriétaire obligatoire, déjà exigé par le prompt maître) afin que A, B, C et D restent possibles. Commercialement, viser B ou D pour le pilote selon le client retenu en D-04.

**Bloque.** Tout traitement de données réelles (pilote) ; choix du stockage objet de production (P1-13 n'est bloqué que pour la configuration de production, pas pour le développement sur MinIO) ; Phase 7.

**Hypothèse provisoire.** Développement et démonstration avec des données fictives uniquement, sur des environnements locaux. Aucune donnée réelle tant que D-01 n'est pas tranchée.

---

## D-02 — Modèle d'isolation SaaS (base partagée + RLS ou base par client) et attentes on-premise

**Question.** Les clients SaaS acceptent-ils une base de données partagée avec isolation logique (colonne `tenant_id`, filtrage applicatif centralisé et Row-Level Security PostgreSQL), ou exigent-ils une base (voire une instance) dédiée par client ? Et pour l'on-premise : une installation = un seul tenant, ou un groupe peut-il héberger plusieurs filiales comme tenants distincts ?

**Pourquoi c'est important.** C'est la décision la plus structurante de la Phase 1 : elle détermine le mécanisme d'accès aux données utilisé par tous les modules. Les grands donneurs d'ordre (pétrole et gaz) imposent parfois une séparation physique par contrat.

**Options.**

| Option                                                                                             | Conséquences                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Base partagée, `tenant_id` + filtrage applicatif + RLS (voir ADR 0002)                          | Un seul schéma à migrer, coût d'exploitation faible, création d'un tenant instantanée. L'isolation repose sur la justesse du mécanisme (d'où les tests d'isolation obligatoires). Sauvegarde/restauration par client plus complexe. |
| B. Une base par client                                                                             | Isolation physique, sauvegarde et restauration par client simples, argument commercial fort. Migrations à exécuter N fois, pool de connexions par base, provisionnement plus lourd, coût par client plus élevé.                     |
| C. Hybride : A par défaut, instance dédiée (même code, mono-tenant) pour les clients qui l'exigent | Reprend le packaging on-premise pour le « SaaS dédié ». Pas de second mécanisme d'accès aux données à maintenir.                                                                                                                    |

**Recommandation.** **C** : coder l'option A (conforme à la règle 4.3 du prompt maître) et proposer une instance dédiée mono-tenant aux clients qui exigent une séparation physique. Le code reste identique ; l'on-premise est le cas « un seul tenant ». Le prompt maître impose déjà A comme mécanisme de base ; la question porte donc surtout sur l'offre commerciale et sur le besoin éventuel de B.

**Bloque.** P1-02 (le lot peut démarrer sur l'hypothèse provisoire ; un passage à B après coup serait une refonte coûteuse).

**Hypothèse provisoire.** Option A/C, telle que décrite dans l'ADR 0002 (statut « Proposé »). On-premise : un seul tenant par installation, créé à l'installation ; le code ne suppose jamais qu'il n'existe qu'un tenant.

---

## D-03 — Fournisseur d'e-mail/SMS et canaux de notification utilisables sur le terrain

**Question.** Par quels canaux la plateforme notifie-t-elle les utilisateurs (invitation, réinitialisation de mot de passe, affectation d'action, échéance dépassée, alerte incident grave) et avec quels fournisseurs ? Les agents de terrain ont-ils tous une adresse e-mail professionnelle ? Le SMS est-il fiable et abordable chez les opérateurs locaux des pays visés ? Une messagerie instantanée est-elle attendue ?

**Pourquoi c'est important.** En site isolé ou offshore, l'e-mail peut ne pas être consulté et le SMS ne pas être reçu. Le coût du SMS vers les opérateurs locaux et la délivrabilité varient fortement. En on-premise, le client impose souvent son propre relais SMTP et peut n'avoir aucun accès Internet sortant.

**Options.**

| Option                                                                               | Conséquences                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. E-mail via SMTP standard (relais configurable) + notifications dans l'application | Fonctionne en SaaS comme en on-premise, aucun fournisseur imposé. Ne touche pas les agents sans e-mail.                                                    |
| B. A + SMS via un agrégateur ou des opérateurs locaux                                | Atteint les agents sans e-mail ; coût par message, contrat par pays, délivrabilité à tester sur place ; inutilisable sans réseau mobile (offshore).        |
| C. A + notifications push mobiles (Phase 5)                                          | Gratuit à l'usage, mais dépend d'un service du fabricant de la plateforme mobile (indisponible sur un réseau fermé on-premise) et de l'application mobile. |
| D. Messagerie instantanée tierce                                                     | Très utilisée localement ; dépendance à un service propriétaire, conditions d'usage professionnelles et confidentialité à étudier.                         |

**Recommandation.** **A** pour les phases 1 et 2, derrière une interface interne de notification (un port « canal » par moyen d'envoi) pour ajouter B puis C sans toucher aux modules métier. Décider B après un test de délivrabilité réel dans le pays du pilote.

**Bloque.** P1-08 uniquement pour la configuration de production (le lot se développe avec un relais SMTP de test local) ; P2-16.

**Hypothèse provisoire.** SMTP générique configurable par variables d'environnement, intercepteur d'e-mails local en développement, aucun SMS.

---

## D-04 — Premier client pilote, secteur et modules indispensables

**Question.** Quel est le premier client pilote (ou le profil cible), dans quel pays et quel secteur (pétrole et gaz, maritime, construction, industrie), en SaaS ou on-premise, avec combien de sites et d'utilisateurs, et quels modules lui sont indispensables dès le premier jour ?

**Pourquoi c'est important.** L'ordre des phases 3 à 6 et le contenu exact du MVP en dépendent. Un pilote offshore rend le POB et le PTW prioritaires ; un pilote construction privilégie inspections, sous-traitants et permis ; un pilote on-premise avance le packaging.

**Options.**

| Option                                                   | Conséquences                                                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Pilote onshore industriel ou construction             | Le MVP de la Phase 2 (incidents, risques, inspections, CAPA) couvre l'essentiel ; ordre des phases inchangé.                                                               |
| B. Pilote pétrole et gaz onshore/offshore                | PTW (Phase 3) et fonctions offshore (Phase 6) attendus tôt ; exigences contractuelles de sécurité plus fortes ; le mobile hors ligne (Phase 5) devient critique plus vite. |
| C. Pas de pilote identifié : construire le MVP générique | Aucune dépendance externe, mais risque de construire des écrans mal adaptés au terrain.                                                                                    |

**Recommandation.** Identifier un pilote **avant l'ouverture de la Phase 2** et faire relire par son responsable QHSE les workflows incident et CAPA. À défaut, suivre l'ordre des phases du prompt maître (option C) sans réordonner.

**Bloque.** Rien dans la Phase 1. Priorisation fine de la Phase 2 et ordre des phases 3 à 6.

**Hypothèse provisoire.** Option C : ordre des phases du prompt maître.

---

## D-05 — Rôles métier de référence et règles de séparation des tâches par défaut

**Question.** Quels rôles la plateforme propose-t-elle par défaut à un nouveau tenant, avec quelles permissions, et quelles règles de séparation des tâches sont actives par défaut (auto-approbation interdite, vérificateur de CAPA différent du responsable, clôture d'incident par un autre que le déclarant, etc.) ?

**Pourquoi c'est important.** Le RBAC (P1-05) a besoin d'un jeu de rôles initial et chaque machine à états (Phase 2) associe un rôle et des conditions à chaque transition. Des règles trop strictes bloquent les petits sites où une même personne cumule les fonctions ; trop lâches, elles vident les contrôles de leur sens.

**Options.**

| Option                                                                                                                        | Conséquences                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A. Jeu de rôles de référence livré, modifiable par tenant ; séparation des tâches stricte par défaut, assouplissable par site | Démarrage rapide, sûr par défaut. Demande un écran de configuration par site.             |
| B. Aucun rôle livré : chaque tenant compose ses rôles                                                                         | Souplesse maximale, mais mise en service longue et risque d'erreurs de configuration.     |
| C. Rôles figés non modifiables                                                                                                | Simple à tester, mais contraire à l'exigence de configuration par entreprise et par site. |

**Recommandation.** **A**, avec la matrice proposée dans `docs/ROLES-PERMISSIONS.md`. Une seule règle n'est pas désactivable car imposée par le prompt maître (5.3) : la vérification d'efficacité d'une CAPA est faite par une autre personne que le responsable de l'action.

**Bloque.** P1-05 (contenu des rôles de démonstration ; le mécanisme n'est pas bloqué), P2-02, P2-04, P2-06 (rôle et conditions par transition).

**Hypothèse provisoire.** Matrice proposée dans `docs/ROLES-PERMISSIONS.md`, séparation des tâches active par défaut et désactivable par site, sauf la règle CAPA ci-dessus.

---

## D-06 — Durées de conservation des dossiers et du journal d'audit

**Question.** Combien de temps conserve-t-on : le journal d'audit ; les dossiers d'incident et d'enquête ; les CAPA ; les évaluations de risques ; les rapports d'inspection ; les documents et leurs versions ; les comptes utilisateurs désactivés ; les données d'un tenant après la fin du contrat ? Qui a le droit de purger, et selon quelle procédure ?

**Pourquoi c'est important.** Les durées dépendent de textes nationaux (droit du travail, sécurité sociale, environnement, protection des données) **à valider par un conseil local** — voir D-01 — et des exigences contractuelles des donneurs d'ordre. Elles s'opposent partiellement au principe de minimisation des données personnelles. Techniquement, elles déterminent le partitionnement du journal d'audit, la volumétrie et la stratégie d'archivage.

**Options.**

| Option                                                                                                                                | Conséquences                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A. Aucune purge automatique tant que les durées ne sont pas validées ; durées configurables par tenant et par type de dossier ensuite | Aucun risque de destruction prématurée ; la volumétrie croît ; il faudra livrer le mécanisme de purge plus tard. |
| B. Durées par défaut codées dès maintenant                                                                                            | Risque de fixer des valeurs juridiquement fausses.                                                               |
| C. Conservation illimitée                                                                                                             | Simple, mais potentiellement contraire aux règles de protection des données.                                     |

**Recommandation.** **A**. Concevoir dès P1-03 un journal d'audit partitionnable par période pour qu'une purge ou un archivage à froid reste possible sans réécrire la table.

**Bloque.** P1-03 et P1-14 seulement pour la purge (non développée) ; Phase 7 (sauvegardes, archivage) ; contrat pilote.

**Hypothèse provisoire.** Aucune suppression physique, aucune purge. Archivage logique uniquement.

---

## D-07 — Synchronisation serveur de site ↔ cloud : périmètre et calendrier

**Question.** Le déploiement hybride (un serveur local sur site qui échange avec le cloud) est-il requis pour le pilote ? Quelles données circulent, dans quel sens, à quelle fréquence, avec quelle autorité en cas de conflit (le site ou le siège) ? Ou bien les sites isolés utilisent-ils seulement l'application mobile hors ligne, synchronisée directement avec un serveur unique ?

**Pourquoi c'est important.** C'est le sujet techniquement le plus risqué du produit. Le prompt maître l'exclut du MVP, interdit la réplication PostgreSQL bidirectionnelle et exige un ADR dédié avant tout code. Son périmètre influence toutefois des choix à ne pas fermer dès la Phase 1 (déjà pris en compte : UUID générés hors ligne, clés d'idempotence, suppression logique, champ de version — ADR 0004).

**Options.**

| Option                                                                                                     | Conséquences                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| A. Pas de serveur de site : cloud (ou on-premise central) + mobile hors ligne uniquement                   | Le plus simple. Insuffisant pour un site qui doit travailler en web plusieurs jours sans liaison.                               |
| B. Serveur de site autonome qui remonte vers le cloud en sens unique (consolidation et reporting au siège) | Pas de conflit à arbitrer ; le siège ne modifie pas les données du site. Couvre le besoin de reporting groupe.                  |
| C. Synchronisation bidirectionnelle par événements métier, avec autorité définie par type de donnée        | Répond à tous les cas ; coût et risque élevés ; arbitrage humain des conflits sensibles obligatoire (prompt maître, section 6). |

**Recommandation.** Reporter la décision à la fin de la Phase 2, viser **B** comme première étape si un besoin réel est confirmé par le pilote (D-04), et n'envisager C que par type de donnée, sur demande justifiée.

**Bloque.** Aucun lot des phases 1 et 2. Conditionne la Phase 5 et le packaging hybride de la Phase 7.

**Hypothèse provisoire.** Option A jusqu'à nouvel ordre. Aucune ligne de code de synchronisation site ↔ cloud avant l'ADR dédié.

---

## D-08 — Modèle de licence et d'activation pour l'on-premise

**Question.** Comment une installation privée est-elle licenciée et activée : par nombre d'utilisateurs, de sites, de modules ; pour une durée limitée ou perpétuelle ; avec ou sans vérification en ligne ? Que se passe-t-il à l'expiration ?

**Pourquoi c'est important.** Beaucoup d'installations on-premise n'auront pas d'accès Internet sortant fiable : une activation en ligne obligatoire est exclue pour elles. Par ailleurs, un logiciel de sécurité ne doit pas cesser de fonctionner brutalement : bloquer l'accès aux permis ou aux incidents à l'expiration d'une licence créerait un risque opérationnel.

**Options.**

| Option                                                                                                | Conséquences                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A. Fichier de licence signé, vérifié hors ligne (limites : modules, sites, utilisateurs, date de fin) | Fonctionne sans Internet ; contournable par un client qui modifie le code, ce qui relève du contrat. |
| B. Activation en ligne périodique                                                                     | Contrôle fort ; inutilisable sur réseau fermé.                                                       |
| C. Pas de contrôle technique, licence purement contractuelle                                          | Aucun développement ; aucun moyen de constater un dépassement.                                       |

**Recommandation.** **A**, avec dégradation douce à l'expiration (bandeau d'avertissement, puis blocage des seules fonctions d'administration et de création de nouveaux sites ou utilisateurs ; **jamais** de blocage de la consultation ni des fonctions de sécurité en cours). À détailler dans un ADR en Phase 7.

**Bloque.** Phase 7 (packaging). Rien avant.

**Hypothèse provisoire.** Aucune. Aucun mécanisme de licence n'est développé avant décision. Les modules restent activables par tenant via la configuration, sans lien avec une licence.

---

## D-09 — Méthodes MFA utilisables avec une connectivité faible

**Question.** Quelle(s) méthode(s) de second facteur pour les comptes privilégiés : TOTP (application d'authentification), SMS, e-mail, clé matérielle ? Quels comptes sont « privilégiés » ? Le MFA est-il imposé ou seulement proposé aux autres comptes ? Quelle procédure de secours en cas de perte du téléphone sur un site isolé ?

**Pourquoi c'est important.** Le SMS dépend du réseau mobile (absent offshore), a un coût et est la méthode la plus exposée aux détournements de ligne. Le TOTP fonctionne sans aucun réseau côté téléphone, mais exige un smartphone, une horloge à peu près juste et une procédure de récupération.

**Options.**

| Option                                                     | Conséquences                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. TOTP + codes de secours à usage unique                  | Fonctionne hors ligne, gratuit, sans fournisseur ; on-premise compatible. Demande un accompagnement à l'enrôlement et une procédure de réinitialisation par un administrateur (tracée). |
| B. SMS                                                     | Familier ; dépend de D-03, du réseau et d'un budget ; plus faible en sécurité.                                                                                                          |
| C. A par défaut, B en option de repli activable par tenant | Couvre les utilisateurs sans smartphone ; double la surface à maintenir.                                                                                                                |
| D. Clés matérielles (WebAuthn)                             | Très robuste ; logistique de distribution difficile ; à envisager plus tard pour les administrateurs.                                                                                   |

**Recommandation.** **A** en Phase 1, obligatoire pour les rôles d'administration du tenant et de gestion des droits, facultatif pour les autres. Réévaluer C après le pilote.

**Bloque.** P1-09.

**Hypothèse provisoire.** Option A. Sont « privilégiés » les comptes qui détiennent `role:manage`, `user:manage` ou `tenant-settings:manage`.

---

## D-10 — Classification des incidents et matrice de risques livrées en configuration « DÉMO »

**Question.** Quelle taxonomie d'incidents (types d'événement, catégories de conséquence, niveaux de gravité réelle et potentielle) et quelle matrice de risques (dimensions, échelles de probabilité et de gravité, seuils d'acceptabilité, mesures obligatoires par niveau) livre-t-on comme configuration de démonstration ?

**Pourquoi c'est important.** Ces référentiels sont configurables par tenant et par site (prompt maître, 5.2), mais il faut un jeu de départ pour les démonstrations et les tests. Les KPI (D-11) dépendent directement de la classification (qu'est-ce qu'un cas « enregistrable », un « accident avec arrêt » ?). Les pratiques varient selon le secteur et le donneur d'ordre ; aucune ne doit être présentée comme norme officielle.

**Options.**

| Option                                                                                                                             | Conséquences                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A. Taxonomie générique inspirée des pratiques courantes du secteur pétrole et gaz + matrice 5 × 5, toutes deux étiquetées « DÉMO » | Parle à la majorité des prospects ; doit être relue par un praticien QHSE pour éviter les contresens.                  |
| B. Reprendre le référentiel du client pilote                                                                                       | Très pertinent pour lui ; dépend de D-04 ; attention à ne pas diffuser un référentiel propriétaire à d'autres tenants. |
| C. Ne rien livrer : chaque tenant configure tout                                                                                   | Aucune hypothèse métier ; démonstration et tests plus laborieux.                                                       |

**Recommandation.** **A**, relue par un praticien QHSE avant la Phase 2, installée uniquement par le seed de démonstration (jamais en production), puis **B** comme configuration propre au pilote.

**Bloque.** Le contenu de démonstration de P2-01 et P2-07 (les mécanismes de configuration ne sont pas bloqués).

**Hypothèse provisoire.** Les lots P2-01 et P2-07 livrent les mécanismes avec un jeu minimal clairement étiqueté « DÉMO — à valider », sans prétendre refléter un référentiel officiel.

---

## D-11 — Définitions KPI de référence et source des heures travaillées

**Question.** (1) Quelles définitions de KPI retient-on comme configuration de départ (voir les candidats de `docs/KPI.md`), avec quel facteur par défaut (200 000 ou 1 000 000 heures) ? (2) D'où viennent les heures travaillées : saisie manuelle mensuelle, import de fichier, interface avec la paie ou le pointage ? (3) Comment distingue-t-on les heures du personnel propre de celles des sous-traitants **avant** que le module Sous-traitants n'existe (Phase 3) ?

**Pourquoi c'est important.** Le prompt maître interdit toute formule ambiguë codée en dur et exige les heures « par entreprise, site et sous-traitant ». Or les sous-traitants sont un module de Phase 3, alors que le dashboard KPI est en Phase 2. Sans heures fiables, tous les taux sont « non calculables ».

**Options (point 3).**

| Option                                                                                                                                                                                              | Conséquences                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A. En Phase 2, les heures sont saisies par entreprise, site, période **et catégorie de population** (personnel propre / sous-traitants, en agrégat) ; le détail par sous-traitant arrive en Phase 3 | Aucune table créée par anticipation ; les KPI peuvent déjà inclure ou exclure les sous-traitants. Migration des données à prévoir en Phase 3. |
| B. Avancer une version minimale de l'entité « sous-traitant » en Phase 2                                                                                                                            | Répond à la lettre du prompt maître, mais anticipe un module de Phase 3.                                                                      |
| C. Ne compter que le personnel propre en Phase 2                                                                                                                                                    | Le plus simple ; KPI incomplets pour les secteurs où la sous-traitance est majoritaire.                                                       |

**Recommandation.** Point 1 : livrer les candidats de `docs/KPI.md` en configuration « DÉMO », facteur choisi par tenant, sans valeur par défaut implicite (le tenant doit choisir). Point 2 : saisie manuelle par période + import CSV en Phase 2. Point 3 : **A**.

**Bloque.** P2-11, P2-12, P2-13.

**Hypothèse provisoire.** Aucune pour les définitions (les KPI restent des candidats non validés). Pour la structure des heures : option A.

---

## D-12 — Identité des utilisateurs et identification du tenant à la connexion

**Question.** Un compte utilisateur appartient-il à un seul tenant, ou une même personne (consultant, sous-traitant intervenant chez plusieurs clients) peut-elle accéder à plusieurs tenants avec un seul compte ? Comment le tenant est-il identifié **au moment de la connexion**, avant qu'une session existe : sous-domaine, code d'organisation saisi, ou adresse e-mail unique sur toute la plateforme ?

**Pourquoi c'est important.** Le prompt maître impose que le tenant soit déduit de la session authentifiée, mais ne dit pas comment il est déterminé à la connexion. Le choix fixe la contrainte d'unicité de l'e-mail et la manière dont la table des utilisateurs est protégée par RLS (ADR 0002 et 0003).

**Options.**

| Option                                                                                                                                         | Conséquences                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Un compte = un tenant ; e-mail unique **par tenant** ; le tenant est identifié à la connexion par un sous-domaine ou un code d'organisation | La table `users` reste strictement sous RLS (le tenant est connu avant la recherche du compte). Une personne présente chez deux clients a deux comptes. Demande des sous-domaines en SaaS (certificat générique) ou un champ supplémentaire. |
| B. Un compte = un tenant ; e-mail unique **sur toute la plateforme**                                                                           | Écran de connexion le plus simple. Exige une recherche de compte hors contexte tenant (chemin privilégié contournant la RLS, à auditer). Empêche une même adresse chez deux clients.                                                         |
| C. Compte global rattaché à plusieurs tenants, choix du tenant après connexion                                                                 | Confortable pour les consultants. Modèle plus complexe (identité globale + appartenances), surface d'attaque plus large.                                                                                                                     |

**Recommandation.** **A**. C'est l'option qui garde l'isolation la plus simple à raisonner ; en on-premise mono-tenant, le code d'organisation est implicite. L'identifiant de tenant fourni à la connexion n'est qu'une donnée d'identification (comme l'e-mail) : après authentification, seul le tenant inscrit dans la session fait foi.

**Bloque.** P1-04 ; contrainte d'unicité de `users` créée en P1-02.

**Hypothèse provisoire.** Option A, avec la résolution du tenant isolée dans un seul composant du module d'authentification pour qu'un passage à B ou C ne touche pas les modules métier.

---

## D-13 — Provisionnement des tenants et rôle « opérateur de plateforme »

**Question.** Qui crée un tenant en SaaS, et comment ? Existe-t-il un rôle d'opérateur de plateforme (personnel de l'éditeur) ayant un accès transverse aux tenants pour le support ?

**Pourquoi c'est important.** Le prompt maître ne décrit aucun back-office d'éditeur. Un compte « super-administrateur » capable de lire tous les tenants est le contournement d'isolation le plus dangereux ; il doit être soit inexistant, soit strictement encadré et tracé.

**Options.**

| Option                                                                                                                            | Conséquences                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Création de tenant par une commande d'administration exécutée sur le serveur (CLI), aucun compte transverse dans l'application | Aucun contournement d'isolation dans l'API. Le support passe par un compte nominatif créé dans le tenant, à la demande du client, et tracé dans son journal d'audit. |
| B. Back-office opérateur avec comptes transverses                                                                                 | Confort d'exploitation ; nécessite un chemin d'accès qui contourne la RLS, donc un périmètre de sécurité et d'audit dédié. Hors périmètre actuel du prompt maître.   |
| C. Inscription en libre-service                                                                                                   | Hors sujet pour une vente B2B accompagnée ; ouvre la porte aux abus.                                                                                                 |

**Recommandation.** **A** pour les phases 1 à 6 ; réexaminer B en Phase 7 (packaging SaaS) par un ADR dédié si l'exploitation le justifie.

**Bloque.** Le volet « création de tenant » de P1-02.

**Hypothèse provisoire.** Option A.

---

## Décisions tranchées

Aucune pour l'instant.

Pour mémoire, les décisions produit déjà validées (non rediscutées ici) figurent dans la section 1 du prompt maître : marché, modèle SaaS + licence privée sur une seule base de code, déploiement hybride, Web + Mobile, FR/EN dès le départ.
