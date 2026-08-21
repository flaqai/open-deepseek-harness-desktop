<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop Symbol">
</p>

<h1 align="center">Open DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>Eine sofort einsetzbare Desktop-Ausgabe von DeepSeek Harness mit Fokus auf sichere Abhängigkeiten</strong>
</p>

Sprachen: [English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · Deutsch · [Português](README.pt-BR.md)

Open DeepSeek Harness Desktop ist eine unabhängige, von der Community gepflegte Desktop-Distribution von [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) für macOS, Windows und Linux. Electron erzeugt keine zweite Agent-Laufzeit, sondern startet und überwacht den lokalen Harness Host sicher und zeigt den bestehenden Web-Client an.

Dieses Repository ist kein offizielles DeepSeek-Produkt. Es wird aktiv entwickelt; Funktionen, Pakete und lokale Datenformate können sich ändern.

## Wichtigste Funktionen

- Desktop-Host mit Prozessüberwachung, Tray, Benachrichtigungen, Protokollzugriff und Wiederherstellung nach Startfehlern.
- Prüfung auf Abhängigkeitskonflikte vor der Plugin-Ausführung; nur nicht sicher reparierbare Plugins werden isoliert.
- Plugin Marketplace, IM-Verbindungen und Skill-Auswahl werden beim ersten Start eingerichtet und bleiben deinstallierbar.
- Offizieller Codex Provider und eine zum Zielsystem und Prozessor passende Codex-Laufzeit.
- Elf Themes, Chat-Hintergründe, lokale Bilder sowie Sprach- und Modellkonfiguration.
- Verbindungen zu WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord und WhatsApp.
- Getrennte Pakete für macOS Apple Silicon/Intel, Windows x64 und Linux x64.

## Installation

Laden Sie das passende Paket von [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases) herunter. Die macOS-Pakete sind ad-hoc signiert und nicht notarisiert, daher kann Gatekeeper beim ersten Start warnen. Prüfen Sie die Herkunft und folgen Sie den Hinweisen auf der Release-Seite.

## Kostenlose API-Token zum Ausprobieren

- [Agnes AI](https://agnes-ai.com/): OpenAI-kompatible Base URL `https://apihub.agnes-ai.com/v1`; `agnes-2.5-flash` ist derzeit eine Option für Agents, Programmierung, Reasoning und Tools.
- [OpenRouter · Ox Alpha](https://openrouter.ai/stealth/ox-alpha?view=api): Base URL `https://openrouter.ai/api/v1`, Modell-ID `stealth/ox-alpha`.

Beide Angebote sind unabhängige Drittanbieter. Kostenlose Kontingente, Preise, Modelle, Limits und Datenrichtlinien können sich ändern. Speichern Sie API Keys im Harness-Zugangsdatenservice und veröffentlichen Sie sie niemals in Issues, Screenshots oder von Git verfolgten Dateien.

## Dokumentation

Vollständige Funktionen, Sicherheitsgrenzen, Paketdetails und Danksagungen finden Sie im [englischen README](README.md) oder im [chinesischen README](README.zh.md). Die Harness-Architektur ist in der [offiziellen Dokumentation](docs/architecture.md) beschrieben.

## FLAQ AI Team

Das FLAQ AI Team pflegt dieses Projekt auf Basis praktischer Erfahrungen mit Modellintegration, lokalen Agent-Umgebungen, Plugin-Auslieferung und plattformübergreifenden Anwendungen. [FLAQ.AI](https://flaq.ai/) bietet einheitlichen API-Zugriff auf Bild-, Video-, Musik- und Sprachmodelle für Agents und Produktionsanwendungen. FLAQ.AI ist optional und wird zum Betrieb dieser Software nicht benötigt.

## Lizenz

[MIT License](LICENSE). Lizenzen von Drittanbietern sind in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) dokumentiert.
