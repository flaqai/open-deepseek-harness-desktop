<p align="center"><img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop Symbol"></p>

# Open DeepSeek Harness Desktop

<p align="center"><strong>Die sofort einsetzbare Community-Desktopausgabe von DeepSeek Harness mit verstärkter Abhängigkeitssicherheit</strong></p>

Sprachen: [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · Deutsch · [Português](README.pt-BR.md)

> [!IMPORTANT]
>
> **[v0.1.2-rc.1 ist verfügbar – jetzt herunterladen und ausprobieren](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).** Diese Version basiert auf DeepSeek Harness 0.1.2-rc.1, ergänzt native Anwendungsmenüs und geschützte Abläufe für Neustart und Beenden, verbessert die macOS-Dock- und Menüleistensymbole und behebt die Eingrenzung des Codex-Systemproxys sowie den Start benutzerdefinierter Profiles.
>
> Dies ist ein Release Candidate. Sichern Sie wichtige Konfigurationen vor dem Upgrade und fügen Sie Problemmeldungen relevante Protokolle oder Diagnoseberichte bei.

Open DeepSeek Harness Desktop ist eine unabhängige, von der Community gepflegte Distribution von [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Die Installer enthalten Node.js, pnpm und die Harness-Laufzeit. Modelle, Coding-Sitzungen, Ausführungsspuren, Plugins, Skills, externe Coding-Werkzeuge und IM-Bots funktionieren daher ohne vorbereitete Entwicklungsumgebung.

> [!NOTE]
>
> Dieses Repository ist kein offizielles DeepSeek-Produkt. Es befindet sich weiterhin in der Vorschau; Datenformate, Kompatibilitätsregeln und Installation können sich noch ändern.

## Aktuelle Hauptfunktionen

- KI-Unterhaltungsbereich mit einstellbarer Breite, Rundennavigation, exaktem Token-Verbrauch und Sendewarteschlange.
- Import in eine unabhängige Umgebung, direkte Freigabe eines Verzeichnisses oder sauberer Neustart.
- Plugin-Suche mit echtem Marktkatalog, Kategorien, lokalem Status und direkter Installation.
- Diagnose vor dem Start, Übungen, Quarantäne und Wiederherstellung für pnpm, Cordis und Loader.
- Scrollbare, sortierbare und dauerhaft gespeicherte Einstellungsnavigation.
- Native Distributionen und Desktop-Integration für Windows, macOS und Linux.

## KI-Unterhaltungsbereich

Abgeschlossene Antworten können Prozessinhalt und System Prompt einklappen. Breite und Schriftgröße sind einstellbar; Markdown-Tabellen skalieren mit dem Text, während kompakte Rundennavigation, exakter Token-Verbrauch pro Antwort und fortlaufende Codehervorhebung lange Unterhaltungen übersichtlich machen.

Der Verlauf zeigt Karten für abgeschlossene, abgebrochene und unterbrochene Antworten. Nicht gesendete Fragen bleiben beim Sitzungswechsel erhalten, und während einer laufenden Sitzung kann die nächste Nachricht in die Sendewarteschlange gelangen. Bilder erscheinen sofort, während Komprimierung und Upload im Hintergrund laufen; Trace-Bilder, hochgeladene lokale Dateien sowie Datei- und Sitzungsreferenzen bleiben auch nach Bearbeitung benachbarten Textes verfügbar.

## Erster Start und unabhängige Datenumgebungen

Beim ersten Start prüft der Client das offizielle Standardverzeichnis ~/.dsh. Ist es nicht vorhanden oder nicht unterstützt, kann ein anderes kompatibles Verzeichnis gewählt oder eine leere Desktop-eigene Umgebung erstellt werden.

### In eine unabhängige Umgebung importieren

Einstellungen, Zugangsdaten, Sitzungen, Workspace-Informationen, Agent-Presets, Skills und Verbindungsstatus werden kopiert, ohne die Quelle zu verändern. Profiles, node_modules, Lockfiles, Plugin-Laufzeiten, Quarantäne- und Gesundheitsdaten sowie anonyme Kennungen werden nicht übernommen. Plugins werden im Desktop-Profile neu installiert; spätere Änderungen bleiben vom offiziellen CLI/Web getrennt.

<p align="center"><img src="./assets/readme/data-home-import-en.png" width="900" alt="Offizielle DSH-Konfiguration in eine unabhängige Umgebung importieren"><br><sub>Unterstützte Daten kopieren und die Quelle unverändert lassen</sub></p>

### Diese Konfiguration direkt verwenden

Verwendet ~/.dsh oder ein anderes kompatibles Verzeichnis ohne zweite Kopie. Einstellungen, Zugangsdaten, Sitzungen, Agent-Presets, Skills, Profiles und Plugins werden geteilt; Desktop und offizielles CLI/Web bearbeiten dieselben Daten.

<p align="center"><img src="./assets/readme/data-home-reuse-en.png" width="900" alt="Vorhandene DSH-Konfiguration direkt verwenden"><br><sub>Desktop teilt die Daten des ausgewählten Verzeichnisses</sub></p>

### Neu beginnen

Erstellt eine leere, unabhängige Umgebung, ohne bestehende Einstellungen, Sitzungen oder Plugins zu lesen oder zu importieren.

<p align="center"><img src="./assets/readme/data-home-fresh-en.png" width="900" alt="Leere unabhängige DSH-Umgebung erstellen"><br><sub>Keine bestehende DSH-Konfiguration wird gelesen oder geändert</sub></p>

### Unabhängiges Datenverzeichnis frei wählen

Sowohl **In eine unabhängige Umgebung importieren** als auch **Neu beginnen** bieten vor dem Fortfahren die Wahl zwischen dem verwalteten Standard und einem leeren eigenen Ordner. Dieser Ordner wird zum unabhängigen Datenstamm des Clients; die Quelle wird weder verändert noch synchronisiert. Unter Windows können Sitzungen, Plugin-Profile und andere wachsende Daten auf D: oder einem anderen Nicht-Systemlaufwerk liegen und so C: entlasten.

<p align="center"><img src="./assets/readme/data-home-import-custom-location-zh.png" width="900" alt="Beim Import einen leeren eigenen Ordner wählen"><br><sub>Unabhängiger Import: vor dem Kopieren Standardort oder leeren Ordner wählen</sub></p>

<p align="center"><img src="./assets/readme/data-home-fresh-custom-location-zh.png" width="900" alt="Beim Neustart einen leeren eigenen Ordner wählen"><br><sub>Neu beginnen: unabhängige Daten am gewählten Ort speichern</sub></p>

Auch nach der Ersteinrichtung kann das Datenverzeichnis unter **Einstellungen → Allgemeine Einstellungen** gewechselt werden. Benutzer können zum unabhängigen Client-Verzeichnis zurückkehren, das offizielle `~/.dsh` direkt verwenden, ein anderes vorhandenes DSH-Verzeichnis wählen oder in einem leeren Ordner eine neue Konfiguration erstellen. Der Wechsel bestimmt nur das nach dem Neustart verwendete Verzeichnis; ursprüngliche Daten werden weder kopiert noch verschoben, zusammengeführt oder gelöscht. Ein leerer Ordner startet nach dem Neustart erneut den Ersteinrichtungsablauf.

<p align="center"><img src="./assets/readme/data-home-switch-after-start-zh.png" width="900" alt="Datenverzeichnis nach dem Start in den allgemeinen Einstellungen wechseln"><br><sub>Sicher zu einer vorhandenen Konfiguration wechseln oder in einem leeren Ordner eine neue unabhängige Konfiguration erstellen</sub></p>

Anschließend führt der Assistent durch Modell-API-Key, mobilen Zugriff, WeChat-/Feishu- und andere IM-Bots sowie eine optionale Codex-Verbindung. Jeder Schritt kann übersprungen und später in den Einstellungen abgeschlossen werden.

## Plugin-Suche, Installation und Aktualisierung

„Plugins erkunden“ liest den echten Plugin-Marketplace-Katalog statt einer festen Liste. Beliebte und kategorisierte Ansichten zeigen Stars, Downloads der letzten 30 Tage und den lokalen Installationsstatus. Plugins können den geschützten Direktinstallationsablauf verwenden oder im vollständigen Markt angezeigt und verwaltet werden.

Ein erfolgreicher Katalog wird 24 Stunden zwischengespeichert; Kategorien wechseln ohne erneuten vollständigen Abruf, und eine manuelle Aktualisierung bleibt möglich. Der Installationsstatus wird bei jedem Öffnen separat gelesen. Netzwerkfehler zeigen den tatsächlichen Grund und lassen mit einem klaren Hinweis weiterhin alte Cache-Daten zu. Lokal installierte Plugins behalten verifizierbare Paket- oder Repository-Identitäten, sodass der Markt die Online-Quelle erkennen und **Wiederherstellen** anbieten kann. Die lokale Quelle selbst wird nicht aktualisiert und muss für normale Update-Prüfungen in die Online-Version umgewandelt werden.

## Auswahl und Wiederherstellung importierter Plugins

Der unabhängige Import kopiert Plugin-Konfiguration und Wiederherstellungsliste, übernimmt aber nie das alte node_modules. Einträge erhalten die Zustände **vom Client bereitgestellt**, **wird geprüft**, **online verfügbar**, **Online-Quelle nicht verfügbar** oder **vorübergehend nicht prüfbar** bei Netzwerk-, Timeout-, Authentifizierungs- oder Rate-Limit-Problemen.

Fehlt eine Online-Quelle, kann der Benutzer ein Quellverzeichnis oder .tgz wählen. Der Client prüft Paketname, Archivpfade, Manifest und Größe; Quellverzeichnisse werden mit deaktivierten Lifecycle-Skripten neu gepackt. Jede Wiederherstellung durchläuft Build-Freigaben, Diagnose geteilter Abhängigkeiten und nötige Quarantäne. Alte node_modules sowie unbekannte oder Zugangsdaten enthaltende Adressen werden nie direkt ausgeführt.

<p align="center"><img src="./assets/readme/imported-plugin-restore-zh.png" width="900" alt="Quellenprüfung und lokale Wiederherstellung importierter Plugins"><br><sub>Quellenstatus, Online-Wiederherstellung und geschützte lokale Wiederherstellung</sub></p>

## Superverstärkte Diagnose

Drittanbieter-Plugins teilen den Node.js-Prozess und den Cordis-Servicegraphen des Hosts. Eine transitive Abhängigkeit, pnpm-Verlinkung oder ein alter Loader-Eintrag kann leere Tool-Aufrufe, .prepare-Fehler oder eine fehlende Plugin-Liste verursachen, bevor die Einstellungen geöffnet werden können.

Darum läuft die Diagnose in der Profile-Komposition und Boot-Schicht statt in einem gewöhnlichen Plugin. Vor Drittanbieter-Code liest sie Manifest, pnpm-lock.yaml, Workspace-Einstellungen, Bundle-Reihenfolge, den tatsächlich installierten Graphen und die gemeinsam genutzte Laufzeit der aktuellen Installation.

### Von der Startquarantäne zur ausführbaren Reparatur

Der Schutz reicht vom Start bis in die Hauptoberfläche: Zuerst erkennt und entfernt die Boot-Schicht das inkompatible Plugin, danach meldet der Client die Quarantäne eindeutig, und Diagnostics zeigt Ursache, ursprüngliche Version sowie konkrete Aktualisierungs- oder Deinstallationsaktionen.

<p align="center"><img src="./assets/readme/diagnostics-startup-quarantine-zh.png" width="900" alt="Inkompatibles dsh-font wird beim Start isoliert"><br><sub>Ein inkompatibles Plugin während des Starts erkennen und isolieren</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-quarantine-notice-zh.png" width="900" alt="Hinweis auf isolierte Plugins nach dem Start"><br><sub>Sicher in die Hauptoberfläche gelangen und das Quarantäneergebnis anzeigen</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-repair-guidance-zh.png" width="900" alt="Diagnose zeigt Ursache und Reparaturaktionen"><br><sub>Ursache, Version, ursprüngliche Quelle und ausführbare Wiederherstellung anzeigen</sub></p>

Cordis Context, Service und Symbol hängen von der physischen Modulidentität ab, nicht nur von der Version. Zwei gleich versionierte Kopien von @deepseek-ai/cordis oder dsh-tools an verschiedenen real paths bleiben getrennte JavaScript-Instanzen. Die Prüfung verfolgt jedes Root-Plugin, direkte und transitive Ketten, deklarierte Bereiche und endgültige Pfade; gültige peerDependencies werden nicht beanstandet.

Geprüft werden Host-Singletons, Profile-/Lockfile-Konsistenz, verwaiste oder doppelte Bundles, Geister-Plugins, pnpm Store, unvollständige Installationen, allowBuilds, prepare-Freigaben und Peer-Deduplizierung.

Die Reihenfolge lautet **nur lesend prüfen → verlustfrei zusammenführen → nur nötige Abhängigkeiten installieren → real paths erneut prüfen → falls nötig isolieren**. Ein gesundes Profile führt pnpm nicht aus. Verwaltete link:-Overrides gelten nur für kompatible Bereiche und senken niemals minimumReleaseAge oder überschreiben allowBuilds: false. Ein erfolgreicher pnpm-Befehl reicht nicht; erst konsistente physische Pfade und Loader-Zustände erlauben den Start.

Ist sichere Konvergenz nicht beweisbar, wird nur das verursachende Root-Plugin aus aktiven Abhängigkeiten und Bundle-Reihenfolge entfernt. Spezifikation, Version, Kette, Grund und Zeitpunkt bleiben erhalten. Quarantäne ist erst abgeschlossen, wenn das Paket physisch aus dem Profile entfernt ist, gemeinsame Host-Pakete auf kanonische Kopien zeigen und die Nachprüfung besteht. So wird aus einem unlesbaren Stack eine Erklärung: wer scheiterte, warum, welcher Schutz griff und was als Nächstes zu tun ist.

Diagnostics zeigt das verantwortliche Plugin, seine Version, den Quarantänegrund und eine Zusammenfassung der Abhängigkeitskette. Benutzer können neu verlinken und die Wiederherstellung erneut versuchen, das exakt erkannte Build-Element freigeben, im Markt nach einer kompatiblen Aktualisierung suchen oder vollständig deinstallieren. Erst eine erfolgreiche erneute Prüfung bringt das Plugin in die Laufzeit zurück.

### Diagnose-Übungszentrum

Entwicklungs- und Installationsversionen enthalten Offline-Beispiele für Host-Schattenkopien, verwaiste Bundles, fehlende Module, ungültige Patches, doppelte Loader, Lifecycle-Fehler, blockierte Build-Freigaben und unterbrochene Reparaturen. Ausgewählte Szenarien laufen nacheinander und zeigen aktuelles Szenario, Phase, verbleibende Szenarien, Ergebnis und Dauer. Das isolierte Ziel ändert das Benutzer-Profile nicht; der erweiterte Modus für das aktive Profile stellt am Ende wieder her und prüft erneut. Kann eine saubere Wiederherstellung nicht bewiesen werden, starten Profile-Plugins nicht neu; anonymisierte JSON- und Textzusammenfassungen werden gespeichert und der JSON-Bericht kann exportiert werden.

<p align="center"><img src="./assets/readme/diagnostics-lab-sandbox-zh.png" width="900" alt="Isolierte Szenarien im Diagnose-Übungszentrum"><br><sub>Isoliertes Ziel: mehrere Fehler ohne Änderung des Benutzer-Profile erproben</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-lab-live-profile-zh.png" width="900" alt="Erweiterter Modus für das aktive Profile"><br><sub>Aktives Profile: Quarantäne, Wiederherstellung und Nachprüfung verifizieren</sub></p>

> [!CAUTION]
>
> In dieser Version ist nicht garantiert, dass die Übung mit dem echten Profile erfolgreich abgeschlossen wird. Sichern Sie vorher die Konfiguration oder verwenden Sie ein isoliertes Datenverzeichnis, da ein erhebliches Absturzrisiko besteht. Verwenden Sie diesen Modus nicht in einer Produktivumgebung. Falls ein echter Test nötig ist, aktivieren Sie jeweils nur ein Szenario.

## Textauswahl und Kontextmenü

Markierter Nur-Lese-Text in Unterhaltung, Tool-Ausgabe, Details oder Dateivorschau zeigt eine horizontale Aktionsleiste. Ein Rechtsklick auf die Auswahl öffnet ein vertikales, abgerundetes Menü.

- **Kopieren** in die Systemzwischenablage.
- **In neuer Unterhaltung fragen**, ohne automatisch zu senden.
- **Zur aktuellen Unterhaltung hinzufügen** als Markdown-Zitat, ohne den Entwurf zu überschreiben.

Wartet die Sitzung auf Auswahl, Bestätigung oder Antwort oder ist der Editor gesperrt, wird „Zur aktuellen Unterhaltung hinzufügen“ automatisch ausgeblendet.

<p align="center">
  <strong>Auswahlleiste</strong><br>
  <img src="./assets/readme/selection-toolbar-zh.png" width="900" alt="Horizontale Leiste nach Textauswahl">
</p>

<p align="center">
  <strong>Kontextmenü</strong><br>
  <img src="./assets/readme/selection-context-menu-zh.png" width="900" alt="Vertikales Kontextmenü bei Rechtsklick">
</p>

## Desktop-Erlebnis

- Tray-Betrieb, vollständiges Beenden und Schnellneustart über macOS-Menüleiste oder Windows-/Linux-Tray.
- Benachrichtigungen bei Startfehler und Erholung, fester Harness-Logzugang, Hilfe nach 15 Sekunden Wartezeit.
- Release-Prüfung, Downloadfortschritt, SHA256SUMS-Prüfung und Öffnen des Installers in den allgemeinen Einstellungen.
- Sichere Registrierung und Entfernung des integrierten dsh-Befehls im System-PATH.
- Eigene Titelleiste unter Windows/Linux, natives macOS-Verhalten und begrenztes Schreiben in die Zwischenablage.
- Codex und Claude Code werden bei Bedarf über **Einstellungen → Externe Werkzeuge** installiert, nicht in den Installer eingebettet.

### Voreingestellte Plugins

Der Installer enthält fünf Start-Presets als integritätsgeprüfte lokale Archive: Plugin Marketplace, dsh-im, dsh-skill-picker, Better Sidebar und dsh-pocket. `dsh-font` wird ausschließlich als Beispiel für Diagnoseübungen bereitgestellt. Deinstalliert ein Benutzer ein Preset, installiert der Client es nicht automatisch erneut.

<p align="center"><img src="./assets/readme/preset-mobile-access-zh.png" width="900" alt="Telefon über Pocket-QR-Code oder LAN-Adresse verbinden"><br><sub>Mobiler Zugriff: im selben Netzwerk scannen und öffentlichen Zugriff nur bei Bedarf aktivieren</sub></p>

<p align="center"><img src="./assets/readme/preset-im-robot-zh.png" width="900" alt="WeChat und weitere IM-Bots über dsh-im verbinden"><br><sub>IM-Bots: WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord und WhatsApp</sub></p>

Die mitgelieferte lokale Version eignet sich zur Offline-Vorbereitung, folgt Markt-Updates aber nicht direkt. Sobald eine Verbindung besteht, unter **Plugin-Markt → Installiert** bei jedem Preset **Wiederherstellen** wählen, um es durch die Online-Version zu ersetzen. Die Wiederherstellung lässt sich nicht automatisch zurückrollen; eine feste lokale Version kann bei Bedarf beibehalten werden.

<p align="center"><img src="./assets/readme/preset-plugin-restore-online-zh.png" width="900" alt="Lokale Presets als Online-Versionen wiederherstellen"><br><sub>Empfohlen: online wiederherstellen und danach normale Update-Prüfungen erhalten</sub></p>

### Anpassbare Einstellungsnavigation

Die linke Einstellungsnavigation besitzt einen eigenen Scrollbereich, sodass von Plugins hinzugefügte Abschnitte erreichbar bleiben. Abschnitte können gezogen werden; ihre Reihenfolge wird lokal gespeichert und beim Installieren oder Entfernen von Plugins stabil zusammengeführt. Unter Windows und Linux verwenden Titelleiste und Harness-Inhalt getrennte native Ansichten, sodass ein Vollbild-Plugin die Fenstersteuerung nicht überdecken kann.

<p align="center"><img src="./assets/readme/settings-navigation-reorder-zh.png" width="900" alt="Einstellungen über die Drei-Linien-Griffe neu anordnen"><br><sub>Abschnitte frei ziehen; die übrigen Zeilen geben weich Platz frei und die endgültige Reihenfolge wird gespeichert</sub></p>

## Themes und Hintergründe

Unterstützt System, Hell, Dunkel und acht Produkt-Themes, acht integrierte Illustrationen und lokale PNG-/JPEG-/WebP-Hintergründe. Eigene Bilder bleiben im lokalen Browserspeicher und werden nicht an das Modell gesendet.

<table><tr><th width="50%">Themes</th><th width="50%">Hintergründe</th></tr><tr><td align="center"><img src="./assets/readme/theme-settings-en.png" alt="Theme-Einstellungen"></td><td align="center"><img src="./assets/readme/background-settings-en.png" alt="Hintergrund-Einstellungen"></td></tr></table>

## Download und Installation

Laden Sie das passende Paket von [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1) herunter.

| System | Architektur | Paket |
| --- | --- | --- |
| macOS | Apple Silicon arm64 | DeepSeek-Harness-macos-arm64.dmg |
| macOS | Intel x64 | DeepSeek-Harness-macos-x64.dmg |
| Windows | x64 | DeepSeek-Harness-windows-x64.exe |
| Linux | Debian / Ubuntu x64 | DeepSeek-Harness-linux-x64.deb |
| Linux | Fedora / RHEL x64 | DeepSeek-Harness-linux-x64.rpm |

Prüfen Sie Dateien mit SHA256SUMS. macOS-Builds sind ad-hoc signiert und nicht notarisiert; bei einer Gatekeeper-Sperre wählen Sie **Systemeinstellungen → Datenschutz & Sicherheit → Dennoch öffnen**. Windows kann für neue oder unsignierte Builds eine Reputationswarnung anzeigen.

## Aus dem Quellcode starten

Installieren Sie Node.js ^22.19.0 oder 24+ und pnpm 11.7.0:

    git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
    cd open-deepseek-harness-desktop
    pnpm install
    pnpm run build
    pnpm run dev:desktop

Für Web allein verwenden Sie pnpm dsh web. Source-Web verwendet das aktuelle DSH_HOME, normalerweise ~/.dsh; installierter Desktop verwendet das beim ersten Start gewählte Verzeichnis. Ob Daten geteilt werden, hängt von dieser Wahl ab.

## Sicherheit, Community und Lizenz

Der Renderer deaktiviert Node-Integration und aktiviert context isolation und Chromium-Sandbox. Navigation ist auf den exakten Harness-loopback-origin beschränkt; es gibt keine allgemeine Bridge für beliebige Befehle, Dateien oder URLs. API-Keys gehören in den Harness-Zugangsdienst.

- [Benutzerhandbuch](docs/user/guide/index.md), [Plugin-Handbuch](docs/user/develop/framework/index.md), [Skill-Handbuch](docs/subsystems/skills.md)
- Fehler und Vorschläge: [GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues)
- Upstream: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Open DeepSeek Harness Desktop steht unter der [MIT-Lizenz](LICENSE). Drittanbieter-Lizenzen finden Sie in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Friends

- [DSHFind](https://dshfind.com/zh) — chinesische Lern- und Austausch-Community für DeepSeek Harness.
