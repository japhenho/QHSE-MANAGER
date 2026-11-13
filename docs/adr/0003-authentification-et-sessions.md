# ADR 0003 — Authentification et sessions

- **Statut :** Proposé (2026-11-13) — dépend de **D-12** (identification du tenant à la connexion) et de **D-09** (méthodes MFA). Les paramètres chiffrés ci-dessous sont des points de départ à confirmer dans les lots P1-04 et P1-09.
- **Références :** prompt maître, sections 3 et 4.3 ; ADR 0002 ; ADR 0005.

## Contexte

L'API est consommée par une application web (navigateur) et, à partir de la Phase 5, par une application mobile utilisée hors ligne pendant de longues périodes. La connectivité est faible et intermittente : une réponse peut se perdre après que le serveur a traité la requête. Le produit doit fonctionner en on-premise sans fournisseur d'identité externe.

## Décision

### 1. Deux jetons

- **Jeton d'accès** : JWT signé, durée de vie courte (ordre de grandeur : 10 à 15 minutes), envoyé dans l'en-tête `Authorization: Bearer`. Il contient l'identifiant de l'utilisateur, celui du tenant et celui de la session. Il **ne contient pas** les permissions : elles sont chargées côté serveur à chaque requête (avec un cache court si nécessaire), afin qu'un retrait de droits prenne effet sans attendre l'expiration du jeton.
- **Jeton de rafraîchissement** : valeur aléatoire opaque (au moins 256 bits), stockée en base **sous forme de hachage** uniquement, rattachée à une « famille » (une famille = une connexion sur un appareil).
- Le choix de l'algorithme de signature, le stockage et la rotation de la clé de signature sont arrêtés dans le lot P1-04. La clé est un secret fourni par l'environnement, jamais commité.

### 2. Rotation et détection de réutilisation

- Chaque rafraîchissement invalide le jeton présenté et en émet un nouveau dans la même famille.
- La présentation d'un jeton déjà utilisé est traitée comme un vol possible : toute la famille est révoquée, l'utilisateur doit se reconnecter, l'événement est inscrit au journal d'audit.
- **Compromis lié à la faible connectivité, assumé et à régler dans P1-04 :** si la réponse à un rafraîchissement se perd, le client rejoue de bonne foi l'ancien jeton et serait déconnecté à tort. Atténuation proposée : pendant une fenêtre de grâce très courte (quelques secondes), rejouer le jeton _immédiatement précédent_ renvoie le même successeur au lieu de révoquer la famille. Cette fenêtre réduit légèrement l'efficacité de la détection ; sa durée et son activation seront paramétrables et couvertes par des tests.
- Durée de vie maximale d'une famille et durée d'inactivité : paramétrables par tenant. La valeur adaptée au mobile hors ligne (rotations de plusieurs semaines en mer) sera fixée en Phase 5.
- Déconnexion, changement de mot de passe, désactivation du compte et retrait de rôle sensible révoquent les familles concernées.

### 3. Stockage côté client

| Client           | Jeton d'accès                                                      | Jeton de rafraîchissement                                                                                             |
| ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Web              | En mémoire uniquement (jamais `localStorage` ni `sessionStorage`). | Cookie `HttpOnly`, `Secure`, `SameSite`, limité au chemin des routes d'authentification.                              |
| Mobile (Phase 5) | En mémoire.                                                        | Stockage sécurisé du système (adossé au magasin de clés matériel quand il existe). Détails dans un ADR de la Phase 5. |

- Le cookie impose de traiter le risque CSRF sur les routes de rafraîchissement et de déconnexion : attribut `SameSite`, contrôle de l'en-tête `Origin`, liste d'origines autorisées explicite (`API_CORS_ORIGINS` existe déjà dans `.env.example`).
- En développement, le web (port 5173) et l'API (port 3000) sont sur des origines différentes : le fonctionnement du cookie dans cette configuration, puis derrière un reverse proxy sur une origine unique en production, **est à vérifier dans P1-04**.
- Au rechargement de la page, le web obtient un nouveau jeton d'accès par un rafraîchissement silencieux.

### 4. Mots de passe

- Hachage **Argon2id**, avec un sel par mot de passe. Paramètres de départ alignés sur les recommandations publiques de l'OWASP (aide-mémoire « Password Storage »), puis calibrés sur le matériel cible ; les paramètres sont stockés avec le hachage pour permettre un re-hachage progressif à la connexion.
- Choix de la bibliothèque dans P1-04 : binaires précompilés disponibles pour Node 22 et pour l'image Docker retenue, licence compatible avec une distribution commerciale, maintenance active — **à vérifier, non présumé**.
- Politique de mot de passe : longueur minimale, refus des mots de passe les plus courants, pas de règle de composition arbitraire ; seuils paramétrables par tenant.
- Réinitialisation et invitation : jeton à usage unique, durée courte, stocké haché. La réponse est identique que le compte existe ou non.

### 5. Limitation de débit et verrouillage

- Limitation par adresse IP et par compte sur la connexion, le rafraîchissement et la réinitialisation.
- Verrouillage **progressif** par compte (délai croissant après des échecs répétés), plutôt qu'un blocage définitif qui permettrait à un tiers de verrouiller un compte à volonté.
- Les compteurs par compte sont stockés dans PostgreSQL : ils survivent au redémarrage et restent justes avec plusieurs instances. La limitation par IP en mémoire n'est correcte qu'avec une seule instance de l'API : limite connue, à lever avec Redis lorsque plusieurs instances seront déployées (le prompt maître n'introduit Redis qu'à l'apparition d'un besoin réel).
- Les messages d'erreur ne distinguent pas « compte inconnu », « mot de passe faux » et « tenant inconnu ».

### 6. MFA

- Obligatoire pour les comptes privilégiés (définition provisoire dans D-09), proposé aux autres.
- Méthode de départ : TOTP + codes de secours à usage unique (D-09, option A) ; le secret TOTP est chiffré au repos.
- La connexion d'un compte soumis au MFA se fait en deux étapes ; aucun jeton d'accès complet n'est émis avant la seconde.
- La réinitialisation du MFA par un administrateur est une action sensible, tracée.

### 7. Traçabilité

Sont inscrits au journal d'audit (ADR 0005) : connexion réussie, échec de connexion sur un compte connu, déconnexion, rafraîchissement refusé pour réutilisation, changement et réinitialisation de mot de passe, enrôlement et réinitialisation du MFA, verrouillage. Les tentatives qui ne peuvent être rattachées à aucun tenant vont dans les journaux techniques structurés, pas dans le journal d'audit d'un tenant. Aucun mot de passe, jeton ou secret n'apparaît dans un journal.

## Alternatives envisagées

| Alternative                                     | Raison du rejet ou du report                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session serveur classique par cookie uniquement | Convient au web, mal au mobile hors ligne ; aurait imposé deux mécanismes.                                                                                                         |
| JWT de longue durée sans rafraîchissement       | Pas de révocation praticable ; contraire au prompt maître.                                                                                                                         |
| Jeton de rafraîchissement dans `localStorage`   | Lisible par tout script injecté dans la page.                                                                                                                                      |
| Fournisseur d'identité externe obligatoire      | Dépendance incompatible avec l'on-premise isolé. La fédération d'identité (OIDC/SAML) d'un client pourra s'ajouter plus tard par un ADR, sans remplacer l'authentification locale. |
| bcrypt ou scrypt                                | Argon2id est imposé par le prompt maître.                                                                                                                                          |
| MFA par SMS par défaut                          | Dépend du réseau mobile et d'un fournisseur (D-03, D-09).                                                                                                                          |

## Conséquences

- **Positif :** révocation effective ; vol de jeton de rafraîchissement détectable ; aucune dépendance externe ; même mécanisme pour le web et le mobile.
- **Coûts et limites assumés :**
  - Un jeton d'accès volé reste utilisable jusqu'à son expiration (d'où la durée courte et le chargement des permissions côté serveur).
  - La fenêtre de grâce est un compromis entre sécurité et tolérance aux coupures.
  - Les opérations hors ligne du mobile seront faites avec des jetons expirés au moment de la synchronisation : la revérification des droits à la synchronisation (prompt maître, section 6) relève de la Phase 5 et n'est pas traitée ici.
  - Tant que D-12 n'est pas tranchée, la résolution du tenant à la connexion reste isolée dans un seul composant.
