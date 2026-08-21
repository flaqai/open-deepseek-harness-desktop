<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Icône Open DeepSeek Harness Desktop">
</p>

<h1 align="center">Open DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>Une édition de bureau de DeepSeek Harness prête à l'emploi et attentive à la sécurité des dépendances</strong>
</p>

[English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · Français · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

Open DeepSeek Harness Desktop est une distribution de bureau indépendante et maintenue par la communauté de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), destinée à macOS, Windows et Linux. Electron ne crée pas un second runtime Agent : il démarre et supervise le Harness Host local de façon sécurisée, puis affiche le client Web existant.

Ce dépôt n'est pas un produit officiel de DeepSeek. Il est en développement actif ; ses fonctionnalités, son empaquetage et ses formats de données locales peuvent évoluer.

## Fonctionnalités principales

- Hôte de bureau avec supervision de Harness, zone de notification, notifications système, accès aux journaux et reprise après un échec de démarrage.
- Détection des conflits de dépendances avant l'exécution des plugins et mise en quarantaine du seul plugin impossible à réparer en toute sécurité.
- Marketplace, connexions IM et sélecteur de Skills installés au premier lancement et toujours désinstallables.
- Provider Codex officiel et runtime Codex correspondant au système et au processeur ciblés.
- Onze thèmes, arrière-plans de conversation, images locales, langue et configuration des modèles.
- Connexion à WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord et WhatsApp.
- Paquets distincts pour macOS Apple Silicon/Intel, Windows x64 et Linux x64.

## Installation

Téléchargez le paquet approprié depuis [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases). Les versions macOS utilisent une signature ad-hoc et ne sont pas notariées ; Gatekeeper peut donc afficher un avertissement au premier lancement. Vérifiez la provenance du fichier et suivez les instructions de la page de version.

## Tokens API gratuits pour l'évaluation

- [Agnes AI](https://agnes-ai.com/) : Base URL compatible OpenAI `https://apihub.agnes-ai.com/v1` ; `agnes-2.5-flash` est un choix actuel pour les Agents, le code, le raisonnement et les outils.
- [OpenRouter · Ox Alpha](https://openrouter.ai/stealth/ox-alpha?view=api) : Base URL `https://openrouter.ai/api/v1`, modèle `stealth/ox-alpha`.

Ces services tiers sont indépendants. Leurs quotas gratuits, tarifs, modèles, limites et politiques de données peuvent changer. Enregistrez les clés dans le gestionnaire d'identifiants Harness et ne les publiez jamais dans une Issue, une capture d'écran ou un fichier suivi par Git.

## Documentation

Consultez le [README anglais](README.md) ou le [README chinois simplifié](README.zh.md) pour les fonctionnalités complètes, les limites de sécurité, l'empaquetage et les remerciements. L'architecture de Harness est décrite dans la [documentation officielle](docs/architecture.md).

## Équipe FLAQ AI

L'équipe FLAQ AI maintient ce projet à partir de son expérience concrète de l'intégration de modèles, des environnements Agent locaux, de la distribution de plugins et des applications multiplateformes. [FLAQ.AI](https://flaq.ai/) fournit un accès API unifié aux modèles d'image, de vidéo, de musique et de langage pour les Agents et les applications de production. FLAQ.AI reste facultatif et n'est pas requis pour exécuter ce logiciel.

## Licence

[MIT License](LICENSE). Les licences tierces sont indiquées dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
