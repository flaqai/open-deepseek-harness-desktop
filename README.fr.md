<p align="center"><img src="./apps/desktop/src/icon.png" width="112" alt="Icône Open DeepSeek Harness Desktop"></p>

# Open DeepSeek Harness Desktop

<p align="center"><strong>L’édition de bureau communautaire de DeepSeek Harness, prête à l’emploi et renforcée pour la sécurité des dépendances</strong></p>

Langues : [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · Français · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

> [!IMPORTANT]
>
> **[v0.1.2-rc.1 est disponible : téléchargez-la et essayez-la](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).** Cette version repose sur DeepSeek Harness 0.1.2-rc.1, ajoute des menus natifs et des procédures protégées de redémarrage et de fermeture, améliore les icônes du Dock et de la barre des menus macOS et corrige la portée du proxy système pour Codex ainsi que le démarrage des Profiles personnalisés.
>
> Il s’agit d’une version candidate. Sauvegardez les configurations importantes avant la mise à niveau et joignez les journaux ou rapports de diagnostic utiles à vos signalements.

Open DeepSeek Harness Desktop est une distribution indépendante et maintenue par la communauté de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Les installateurs incluent Node.js, pnpm et le runtime Harness : configuration des modèles, sessions de code, traces d’exécution, plugins, Skills, outils de code externes et bots IM fonctionnent sans préparer un environnement de développement.

> [!NOTE]
>
> Ce dépôt n’est pas un produit officiel de DeepSeek. Il reste en préversion ; formats de données, politiques de compatibilité et installation peuvent encore évoluer.

## Principales fonctions actuelles

- Espace de conversation avec largeur réglable, navigation par tours, consommation exacte de Token et file d’envoi.
- Import dans un environnement indépendant, partage direct d’un dossier ou nouveau départ.
- Découverte de plugins fondée sur le vrai catalogue, les catégories, l’état local et l’installation directe.
- Diagnostic avant démarrage, exercices, quarantaine et récupération pour pnpm, Cordis et Loader.
- Navigation des Réglages défilable, réordonnable et persistante.
- Distributions natives et intégration de bureau pour Windows, macOS et Linux.

## Espace de conversation IA

Les réponses terminées peuvent replier le processus et le System Prompt. La largeur et la taille du texte sont réglables ; les tableaux Markdown suivent la taille du corps, tandis que la navigation compacte par tours, la consommation exacte de Token et la coloration continue du code facilitent l’examen des longues conversations.

L’historique utilise des cartes qui distinguent les réponses terminées, annulées et interrompues. Un brouillon non envoyé reste présent après un changement de session et le prochain message peut rejoindre la file pendant une exécution. Les images s’affichent immédiatement pendant la compression et l’envoi en arrière-plan ; les images de la trace, les fichiers locaux envoyés et les références de fichier ou de session restent également utilisables après modification du texte adjacent.

## Premier démarrage et environnements indépendants

Au premier lancement, le client vérifie le dossier DSH officiel par défaut ~/.dsh. S’il est absent ou non pris en charge, vous pouvez choisir un autre dossier compatible ou créer un environnement vide appartenant à Desktop.

### Importer dans un environnement indépendant

Les réglages, identifiants, sessions, espaces de travail, presets Agent, Skills et connexions sont copiés sans modifier la source. Profiles, node_modules, lockfiles, runtimes de plugins, états de quarantaine et identifiants anonymes ne le sont pas. Les plugins sont réinstallés dans le Profile Desktop ; les changements ultérieurs restent séparés du CLI/Web officiel.

<p align="center"><img src="./assets/readme/data-home-import-en.png" width="900" alt="Importer une configuration DSH officielle dans un environnement indépendant"><br><sub>Copier les données prises en charge sans modifier la source</sub></p>

### Utiliser directement cette configuration

Utilisez ~/.dsh ou un autre dossier compatible sans créer de copie. Réglages, identifiants, sessions, presets Agent, Skills, Profiles et plugins sont partagés ; Desktop et CLI/Web modifient les mêmes données.

<p align="center"><img src="./assets/readme/data-home-reuse-en.png" width="900" alt="Utiliser directement une configuration DSH existante"><br><sub>Desktop partage les données du dossier sélectionné</sub></p>

### Repartir de zéro

Créez un environnement vide et indépendant sans lire ni importer les réglages, sessions ou plugins existants.

<p align="center"><img src="./assets/readme/data-home-fresh-en.png" width="900" alt="Créer un environnement DSH indépendant et vide"><br><sub>Aucune configuration DSH existante n’est lue ou modifiée</sub></p>

### Choisir un répertoire de données indépendant

**Importer dans un environnement indépendant** et **Repartir de zéro** permettent de choisir avant de continuer entre l’emplacement géré par défaut et un dossier vide personnalisé. Ce dossier devient la racine indépendante du client ; la source n’est ni modifiée ni synchronisée. Sous Windows, les sessions, Profiles de plugins et autres données croissantes peuvent être placés sur D: ou un autre volume non système afin de soulager C:.

<p align="center"><img src="./assets/readme/data-home-import-custom-location-zh.png" width="900" alt="Choisir un dossier vide lors de l’import"><br><sub>Import indépendant : choisir l’emplacement par défaut ou un dossier vide avant la copie</sub></p>

<p align="center"><img src="./assets/readme/data-home-fresh-custom-location-zh.png" width="900" alt="Choisir un dossier vide pour repartir de zéro"><br><sub>Repartir de zéro : placer les nouvelles données indépendantes à l’emplacement choisi</sub></p>

Après la configuration initiale, le répertoire de données peut encore être changé depuis **Réglages → Réglages généraux**. Il est possible de revenir au répertoire indépendant du client, d’utiliser directement le `~/.dsh` officiel, de choisir un autre répertoire DSH existant ou de créer une nouvelle configuration dans un dossier vide. Le changement sélectionne uniquement le répertoire utilisé après redémarrage ; il ne copie, déplace, fusionne ni ne supprime les données d’origine. Un dossier vide relance le parcours de première installation après le redémarrage.

<p align="center"><img src="./assets/readme/data-home-switch-after-start-zh.png" width="900" alt="Changer le répertoire de données depuis les Réglages généraux après l’ouverture du client"><br><sub>Basculer en sécurité vers une configuration existante ou en créer une nouvelle dans un dossier vide</sub></p>

L’assistant peut ensuite configurer la clé API du modèle, connecter l’accès mobile, préparer les bots IM WeChat, Feishu et autres, puis connecter Codex si nécessaire. Chaque étape peut être ignorée et terminée plus tard dans les Réglages.

## Découverte, installation et mise à jour des plugins

« Explorer les plugins » consulte le vrai catalogue du Plugin Marketplace au lieu d’une liste fixe. Les vues populaires et par catégorie affichent les Stars, les téléchargements des 30 derniers jours et l’état local. Un plugin peut suivre directement le flux d’installation contrôlé ou être ouvert dans le marché complet pour consultation et gestion.

Le catalogue réussi est mis en cache pendant 24 heures, et changer de catégorie ne le télécharge pas de nouveau ; une actualisation forcée reste disponible. L’état installé est relu séparément à chaque ouverture. Une panne réseau affiche sa cause réelle et, si un ancien cache existe, permet de continuer avec un avertissement. Les plugins locaux conservent une identité de paquet ou de dépôt vérifiable, ce qui permet au marché d’identifier la source en ligne et de proposer **Restaurer** ; la source locale elle-même n’est pas mise à jour et doit être restaurée en version en ligne pour participer aux vérifications normales.

## Sélection et restauration des plugins importés

L’import indépendant copie la configuration et une liste de restauration, jamais l’ancien node_modules. Chaque entrée reçoit un état : **fourni par le client**, **vérification en cours**, **disponible en ligne**, **source en ligne indisponible** ou **vérification temporairement impossible** en cas de réseau, délai, authentification ou limitation.

Si la source en ligne manque, l’utilisateur peut choisir un dossier source ou un .tgz. Le client valide le nom du paquet, les chemins de l’archive, le manifest et la taille ; un dossier source est remballé avec les scripts de cycle de vie désactivés. Toute restauration passe par les autorisations de build, le diagnostic des dépendances partagées et la quarantaine si nécessaire. L’ancien node_modules et les adresses inconnues ou contenant des identifiants ne sont jamais exécutés directement.

<p align="center"><img src="./assets/readme/imported-plugin-restore-zh.png" width="900" alt="Vérification de source et restauration locale des plugins importés"><br><sub>État des sources, restauration en ligne et restauration locale protégée</sub></p>

## Diagnostics super-renforcés

Les plugins tiers partagent le processus Node.js et le graphe de services Cordis du Host. Une dépendance transitive, le mode de liaison pnpm ou une ancienne entrée Loader peut provoquer des appels d’outil vides, des erreurs .prepare ou une liste de plugins absente avant même l’ouverture des Réglages.

Le diagnostic s’exécute donc dans la composition du Profile et la couche de démarrage, pas dans un plugin ordinaire. Avant tout code tiers, il lit le manifest, pnpm-lock.yaml, les réglages Workspace, l’ordre des Bundles, le graphe réellement installé et le runtime partagé de l’installation courante.

### De la quarantaine au démarrage à une réparation exploitable

La protection couvre le démarrage et l’interface principale : la couche de boot identifie et retire d’abord le plugin incompatible, le client annonce clairement ce qui a été isolé, puis Diagnostics affiche la cause, la version d’origine et des actions concrètes de mise à jour ou de désinstallation.

<p align="center"><img src="./assets/readme/diagnostics-startup-quarantine-zh.png" width="900" alt="Mise en quarantaine de dsh-font au démarrage"><br><sub>Détecter et isoler un plugin incompatible pendant le démarrage</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-quarantine-notice-zh.png" width="900" alt="Notification des plugins isolés après le démarrage"><br><sub>Entrer dans l’interface en sécurité puis indiquer précisément les éléments isolés</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-repair-guidance-zh.png" width="900" alt="Cause et actions de réparation dans Diagnostics"><br><sub>Afficher la cause, la version, la source d’origine et les choix de récupération</sub></p>

Les Context, Service et Symbol de Cordis dépendent de l’identité physique du module, pas seulement de la version. Deux copies de @deepseek-ai/cordis ou dsh-tools de même version mais de real paths différents restent deux instances JavaScript. L’inspection parcourt chaque plugin racine, les dépendances directes et transitives, les plages déclarées et les chemins résolus ; les peerDependencies valides ne sont pas signalées.

Elle contrôle les singletons Host, la cohérence Profile/lockfile, les Bundles orphelins ou dupliqués, les plugins fantômes, le Store pnpm, les installations incomplètes, allowBuilds, les permissions prepare et la déduplication peer.

L’ordre est **inspection en lecture seule → convergence sans perte → installation du strict nécessaire → nouvelle vérification des real paths → quarantaine si nécessaire**. Un Profile sain ne lance pas pnpm. Les overrides link: gérés ne sont utilisés que pour une plage compatible et ne réduisent jamais minimumReleaseAge ni un allowBuilds: false explicite. Un succès pnpm ne suffit pas : le démarrage reprend seulement après cohérence des chemins physiques et du Loader.

Si la convergence ne peut pas être prouvée sûre, seul le plugin racine responsable est retiré des dépendances actives et de l’ordre des Bundles. Spécification, version, chaîne, motif et date sont conservés. La quarantaine n’est terminée que lorsque le paquet a physiquement quitté le Profile, que les Host partagés pointent vers les copies canoniques et que la nouvelle inspection réussit. Le but est d’expliquer qui a échoué, pourquoi, quelle protection a été appliquée et quoi faire ensuite.

Diagnostics affiche le plugin responsable, sa version, le motif de quarantaine et un résumé de la chaîne de dépendances. L’utilisateur peut relier et retenter la récupération, approuver l’élément de build précisément identifié, rechercher une mise à jour compatible dans le marché ou désinstaller complètement. Le plugin ne rejoint le runtime qu’après une nouvelle inspection réussie.

### Centre d’exercices de diagnostic

Les versions de développement et installée fournissent des échantillons hors ligne pour reproduire des copies Host parallèles, Bundles orphelins, modules absents, Patch invalides, Loader dupliqués, échecs de cycle de vie, autorisations de build bloquées et réparations interrompues. Les scénarios choisis s’exécutent dans l’ordre et affichent le scénario et la phase en cours, les scénarios restants, le résultat et la durée. La cible isolée ne modifie pas le Profile utilisateur ; le mode avancé sur le vrai Profile restaure et réinspecte à la fin. Si la récupération propre ne peut pas être démontrée, les plugins ne redémarrent pas ; des résumés JSON et texte anonymisés sont conservés et le rapport JSON peut être exporté.

<p align="center"><img src="./assets/readme/diagnostics-lab-sandbox-zh.png" width="900" alt="Scénarios isolés du centre d’exercices"><br><sub>Cible isolée : exercer plusieurs pannes sans modifier le Profile utilisateur</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-lab-live-profile-zh.png" width="900" alt="Mode avancé sur le Profile actif"><br><sub>Profile actif avancé : vérifier la quarantaine, la récupération et la réinspection</sub></p>

> [!CAUTION]
>
> Dans cette version, la réussite de l’exercice sur le vrai Profile n’est pas garantie. Sauvegardez la configuration ou utilisez un répertoire de données isolé avant de le lancer, car le risque de plantage est élevé. N’utilisez pas ce mode en production. Si un test réel est indispensable, n’activez qu’un seul scénario à la fois.

## Sélection de texte et menu contextuel

Sélectionner du texte en lecture seule dans une conversation, une sortie d’outil, un détail ou un aperçu de fichier affiche une barre horizontale. Un clic droit sur la sélection ouvre un menu vertical arrondi.

- **Copier** vers le presse-papiers.
- **Demander dans une nouvelle conversation** sans envoyer automatiquement.
- **Ajouter à la conversation actuelle** sous forme de citation Markdown sans écraser le brouillon.

Quand la session attend un choix, une confirmation ou une réponse, ou que l’éditeur est désactivé, l’ajout à la conversation actuelle disparaît automatiquement.

<p align="center">
  <strong>Barre de sélection</strong><br>
  <img src="./assets/readme/selection-toolbar-zh.png" width="900" alt="Barre horizontale après sélection">
</p>

<p align="center">
  <strong>Menu contextuel</strong><br>
  <img src="./assets/readme/selection-context-menu-zh.png" width="900" alt="Menu vertical après clic droit">
</p>

## Expérience de bureau

- Exécution en zone de notification, sortie complète et redémarrage rapide depuis macOS ou Windows/Linux.
- Notifications d’échec et de reprise, accès au journal Harness fixe, aide après 15 secondes d’attente.
- Recherche de Release, progression du téléchargement, validation SHA256SUMS et ouverture de l’installateur dans les Réglages généraux.
- Ajout et suppression sûrs de la commande dsh intégrée dans le PATH système.
- Barre de titre personnalisée Windows/Linux, comportement natif macOS, écriture presse-papiers limitée.
- Codex et Claude Code sont installés à la demande depuis **Réglages → Outils externes**, et non intégrés aux installateurs.

### Plugins prédéfinis

L’installateur contient cinq presets de démarrage sous forme d’archives locales dont l’intégrité est vérifiée : Plugin Marketplace, dsh-im, dsh-skill-picker, Better Sidebar et dsh-pocket. `dsh-font` est fourni uniquement comme échantillon pour les exercices de diagnostic. Lorsqu’un utilisateur désinstalle un preset, le client ne le réinstalle pas automatiquement.

<p align="center"><img src="./assets/readme/preset-mobile-access-zh.png" width="900" alt="Connecter un téléphone par le QR code ou l’adresse LAN de Pocket"><br><sub>Accès mobile : scanner sur le même réseau et activer l’accès public uniquement si nécessaire</sub></p>

<p align="center"><img src="./assets/readme/preset-im-robot-zh.png" width="900" alt="Connecter WeChat et d’autres bots IM avec dsh-im"><br><sub>Bots IM : WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord et WhatsApp</sub></p>

La version locale intégrée facilite la préparation hors ligne, mais ne suit pas directement les mises à jour du marché. Une fois connecté, ouvrez **Marché des plugins → Installés** et utilisez **Restaurer** pour chaque preset afin de le remplacer par sa version en ligne. La restauration n’est pas automatiquement réversible ; conservez la version locale si un paquet hors ligne figé est préférable.

<p align="center"><img src="./assets/readme/preset-plugin-restore-online-zh.png" width="900" alt="Restaurer les presets locaux comme versions en ligne"><br><sub>Recommandé : restaurer en ligne pour participer aux vérifications normales de mise à jour</sub></p>

### Navigation des Réglages personnalisable

La navigation gauche des Réglages possède son propre défilement afin que les sections ajoutées par des plugins restent accessibles. Les sections peuvent être déplacées et leur ordre est enregistré localement, puis fusionné de façon stable lors de l’installation ou de la suppression d’un plugin. Sous Windows et Linux, la barre de titre et le contenu Harness utilisent des vues natives séparées ; un plugin plein écran ne peut donc pas recouvrir les commandes de fenêtre.

<p align="center"><img src="./assets/readme/settings-navigation-reorder-zh.png" width="900" alt="Réordonner les Réglages avec les poignées à trois lignes"><br><sub>Déplacez librement les sections ; les autres lignes libèrent la place en douceur et l’ordre final est enregistré</sub></p>

## Thèmes et arrière-plans

Modes système, clair, sombre, huit thèmes produit, huit illustrations intégrées et arrière-plans PNG/JPEG/WebP locaux. Les images personnalisées restent dans le stockage local du navigateur et ne sont pas envoyées au modèle.

<table><tr><th width="50%">Thèmes</th><th width="50%">Arrière-plans</th></tr><tr><td align="center"><img src="./assets/readme/theme-settings-en.png" alt="Réglages des thèmes"></td><td align="center"><img src="./assets/readme/background-settings-en.png" alt="Réglages des arrière-plans"></td></tr></table>

## Télécharger et installer

Téléchargez le paquet adapté depuis [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).

| Système | Architecture | Paquet |
| --- | --- | --- |
| macOS | Apple Silicon arm64 | DeepSeek-Harness-macos-arm64.dmg |
| macOS | Intel x64 | DeepSeek-Harness-macos-x64.dmg |
| Windows | x64 | DeepSeek-Harness-windows-x64.exe |
| Linux | Debian / Ubuntu x64 | DeepSeek-Harness-linux-x64.deb |
| Linux | Fedora / RHEL x64 | DeepSeek-Harness-linux-x64.rpm |

Vérifiez les fichiers avec SHA256SUMS. Les builds macOS sont signés ad-hoc et non notariés ; si Gatekeeper bloque l’application, utilisez **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Windows peut afficher un avertissement de réputation pour une build récente ou non signée.

## Exécuter depuis les sources

Installez Node.js ^22.19.0 ou 24+ et pnpm 11.7.0 :

    git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
    cd open-deepseek-harness-desktop
    pnpm install
    pnpm run build
    pnpm run dev:desktop

Pour Web seulement, utilisez pnpm dsh web. Le Web source utilise le DSH_HOME courant, généralement ~/.dsh ; Desktop installé utilise le dossier choisi au premier lancement. Le partage dépend de ce choix.

## Sécurité, communauté et licence

Le renderer désactive l’intégration Node et active context isolation et le sandbox Chromium. La navigation est limitée à l’origine loopback exacte de Harness ; aucun bridge générique n’expose commandes, fichiers ou URL arbitraires. Stockez les clés API avec le service d’identifiants Harness.

- [Guide utilisateur](docs/user/guide/index.md), [guide des plugins](docs/user/develop/framework/index.md), [guide des Skills](docs/subsystems/skills.md)
- Bugs et idées : [GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues)
- Projet amont : [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Open DeepSeek Harness Desktop est publié sous [licence MIT](LICENSE). Les licences tierces figurent dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Friends

- [DSHFind](https://dshfind.com/zh) — communauté chinoise d’apprentissage et de partage autour de DeepSeek Harness.
