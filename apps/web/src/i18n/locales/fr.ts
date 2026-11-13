/**
 * French translations — the reference locale.
 * The shape of this object defines the `Translation` type every other locale must satisfy.
 */
export const fr = {
  app: {
    name: 'QHSE Manager',
    tagline: 'Qualité · Santé · Sécurité · Environnement',
    skipToContent: 'Aller au contenu principal',
    loading: 'Chargement…',
    offline: 'Hors ligne',
    pageTitle: '{{page}} — QHSE Manager',
  },
  nav: {
    label: 'Navigation principale',
    openMenu: 'Ouvrir le menu',
    closeMenu: 'Fermer le menu',
    home: 'Accueil',
    systemStatus: 'État du système',
  },
  language: {
    label: 'Langue',
  },
  common: {
    retry: 'Réessayer',
    reload: 'Recharger la page',
    backToHome: "Retour à l'accueil",
    reference: 'Référence : {{id}}',
  },
  errors: {
    title: 'Une erreur est survenue',
    offline: 'Vous êtes hors ligne. Vérifiez votre connexion puis réessayez.',
    network: "Impossible de joindre le serveur. Vérifiez votre connexion ou l'adresse de l'API.",
    timeout: "Le serveur n'a pas répondu à temps. La connexion est peut-être trop lente.",
    server: 'Le serveur a rencontré une erreur. Réessayez dans quelques instants.',
    client: "La demande n'a pas pu être traitée.",
    invalidResponse: 'Le serveur a renvoyé une réponse inattendue.',
    unexpected: "Une erreur inattendue s'est produite.",
    routeTitle: "Cette page n'a pas pu être affichée",
    routeDescription:
      'Le chargement a échoué, souvent à cause d’une connexion instable. Rechargez la page pour réessayer.',
    configTitle: 'Configuration invalide',
    configDescription:
      "La variable {{variable}} est absente ou invalide. L'application ne peut pas contacter l'API. Corrigez la configuration puis relancez l'application.",
  },
  auth: {
    title: 'Connexion',
    subtitle: 'Connectez-vous avec les identifiants fournis par votre organisation.',
    organization: "Code d'organisation",
    organizationHint: 'Communiqué par votre administrateur, par exemple « acme-congo ».',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    submit: 'Se connecter',
    submitting: 'Connexion en cours…',
    restoring: 'Vérification de votre session…',
    signOut: 'Se déconnecter',
    signedInAs: 'Connecté : {{email}}',
    fieldErrors: {
      organization: "Saisissez le code d'organisation (3 caractères au minimum).",
      email: 'Saisissez une adresse e-mail valide.',
      password: 'Saisissez votre mot de passe.',
    },
    errors: {
      invalidCredentials: "Code d'organisation, adresse e-mail ou mot de passe incorrect.",
      invalidForm: 'Vérifiez les champs signalés puis réessayez.',
      tooManyAttempts_one: 'Trop de tentatives. Réessayez dans {{count}} minute.',
      tooManyAttempts_other: 'Trop de tentatives. Réessayez dans {{count}} minutes.',
    },
  },
  home: {
    title: 'Accueil',
    description: 'Plateforme QHSE pour les opérations industrielles.',
    foundationTitle: 'Socle technique en place',
    foundationBody:
      "Cette version contient uniquement les fondations de l'application : navigation, système de design, interface en français et en anglais, et liaison avec l'API. Aucune donnée métier n'est encore gérée.",
    foundationBadge: 'Phase 0',
    statusTitle: "Liaison avec l'API",
    statusBody:
      "La page « État du système » interroge l'API en temps réel et indique si elle est joignable.",
    statusLink: "Voir l'état du système",
    modulesTitle: 'Modules',
    modulesEmptyTitle: 'Aucun module disponible pour le moment',
    modulesEmptyBody:
      'Les modules métier apparaîtront ici et dans le menu au fur et à mesure de leur livraison.',
  },
  systemStatus: {
    title: 'État du système',
    description: "Vérification en direct de la liaison entre cette application et l'API.",
    refresh: 'Vérifier à nouveau',
    checking: 'Vérification en cours…',
    lastChecked: 'Dernière vérification : {{time}}',
    apiUrl: "Adresse de l'API",
    checksTitle: 'Contrôles',
    live: {
      title: 'Disponibilité',
      description: "L'API répond aux requêtes.",
    },
    ready: {
      title: 'Services dépendants',
      description: "L'API et ses dépendances (base de données) sont prêtes à traiter les demandes.",
    },
    state: {
      checking: 'Vérification…',
      ok: 'Opérationnel',
      notReady: 'Non prêt',
      unreachable: 'Injoignable',
      offline: 'Hors ligne',
      error: 'Erreur',
    },
    notReadyDetail:
      "L'API répond, mais au moins une de ses dépendances n'est pas prête. Réessayez dans quelques instants.",
    summary: {
      checking: 'Vérification de la liaison avec l’API…',
      ok: "L'API est joignable et prête.",
      degraded: "L'API est joignable, mais n'est pas prête.",
      down: "L'API est injoignable.",
      offline: 'Cet appareil est hors ligne. La vérification reprendra au retour de la connexion.',
    },
  },
  notFound: {
    title: 'Page introuvable',
    description: "L'adresse demandée n'existe pas ou n'est plus disponible.",
  },
};
