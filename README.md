<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop icon">
</p>

<h1 align="center">Open DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>An open, extensible desktop workspace for DeepSeek Harness</strong>
</p>

English | [简体中文](README.zh.md) | [繁體中文](README_tw.md) | [日本語](README_ja.md) | [한국어](README_ko.md) | [Deutsch](README_de.md) | [Español](README_es.md) | [Français](README_fr.md) | [Italiano](README_it.md) | [Português](README_pt.md) | [Русский](README_ru.md) | [العربية](README_ar.md) | [Bahasa Indonesia](README_id.md) | [ไทย](README_th.md) | [Tiếng Việt](README_vi.md)

<p align="center">
  <a href="https://github.com/flaqai/open-deepseek-harness-desktop/releases"><img src="https://img.shields.io/github/downloads/flaqai/open-deepseek-harness-desktop/total.svg?style=flat" alt="Downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/flaqai/open-deepseek-harness-desktop?style=flat" alt="MIT License"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/upstream-DeepSeek%20Harness-4d6bfe?style=flat" alt="DeepSeek Harness upstream"></a>
</p>

Open DeepSeek Harness Desktop is an independent, community-maintained desktop distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It combines the upstream plugin-based agent runtime with a visual workspace for configuring models, running coding sessions, inspecting execution, and managing extensions.

This repository is not an official DeepSeek product. It is released under the [MIT License](LICENSE) and keeps the Harness architecture intact: capabilities remain plugins, while the Electron application acts as a secure local host for the existing Web client.

**Development notice:** Open DeepSeek Harness Desktop is under active development. Features, packaging, and the local data schema may change. This is an independent community project, not an official DeepSeek product.

## Release status

The project is in developer preview and may introduce breaking changes. We are preparing the same five desktop release variants listed below. macOS Apple Silicon is the first locally packaged and validated target; the other rows describe the committed release matrix and will become downloadable as their native build and validation work is completed.

## What you can do

- Connect to DeepSeek by default or configure a compatible API base URL, API key reference, and custom model identifiers from onboarding or Settings.
- Open local workspaces, create persistent sessions, stream agent responses, copy messages, remove sessions, and clear conversation history.
- Review model-visible execution records and concise key-step summaries so important tool activity is easier to confirm.
- Discover Harness plugins, install supported registry plugins through a reviewed one-click flow, inspect installed plugins, and invoke Skills.
- Personalize the client with color palettes, original built-in backgrounds, and a local custom chat background without obscuring the working area.
- Check the fixed official upstream for stable Harness changes and perform a guarded clean fast-forward update from desktop source runs.
- Extend the product through Cordis plugins instead of storing desktop-only copies of provider, session, plugin, or Skill state.

## Installation

Download builds only from the official [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases) page. Release assets will follow this matrix:

| Platform | Architecture | Release package |
| --- | --- | --- |
| macOS | Apple Silicon (`arm64`) | `DeepSeek-Harness-macos-arm64.dmg` |
| macOS | Intel (`x64`) | `DeepSeek-Harness-macos-x64.dmg` |
| Windows | `x64` | `DeepSeek-Harness-windows-x64.exe` |
| Linux | Debian / Ubuntu (`x64`) | `DeepSeek-Harness-linux-x64.deb` |
| Linux | Fedora / RHEL (`x64`) | `DeepSeek-Harness-linux-x64.rpm` |

Published releases will also include a `SHA256SUMS` file so downloaded artifacts can be verified before installation. An asset is supported only after it appears on the Releases page; the table itself is not an availability claim.

### macOS

1. Download the package matching your Mac processor and open the `.dmg`.
2. Drag `DeepSeek Harness.app` into the Applications folder.
3. Current open-source builds use ad-hoc signing and are not notarized. If Gatekeeper blocks the first launch, use **System Settings → Privacy & Security → Open Anyway**. Alternatively, after confirming the download came from this repository, run:

   ```bash
   xattr -dr com.apple.quarantine "/Applications/DeepSeek Harness.app"
   ```

> [!CAUTION]
>
> Removing the quarantine attribute bypasses a macOS security check. Use the command only for this exact application path and only for a package downloaded from the official Releases page. You can also try Apple's [Open Anyway](https://support.apple.com/102445) flow under **System Settings → Privacy & Security**.

### Windows

Download and run the Windows x64 installer. Windows may display a reputation-based warning for an unsigned or newly published build; continue only after checking the publisher repository and the release checksum.

### Linux

Install the package matching your distribution:

```bash
# Debian / Ubuntu
sudo apt install "/path/to/DeepSeek-Harness-linux-x64.deb"

# Fedora / RHEL
sudo dnf install "/path/to/DeepSeek-Harness-linux-x64.rpm"
```

<a id="run"></a><a id="run-from-source"></a>

## Quick start

Install Node.js `^22.19.0 || >=24.0.0` and pnpm `11.7.0`, then run:

```sh
git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
cd open-deepseek-harness-desktop
pnpm install
pnpm run build
pnpm run dev:desktop
```

The desktop host starts a local Harness process and opens its loopback Web UI in a hardened Electron window. To run only the Web client from the same checkout:

```sh
pnpm dsh web
```

See the [desktop application reference](apps/desktop/README.md) for environment overrides, process supervision, update behavior, and current limitations. The [Web UI guide](docs/user/guide/index.md) covers the browser workflow.

## Platform status

| Platform | Current status | Next release work |
| --- | --- | --- |
| macOS Apple Silicon | Ad-hoc DMG/ZIP packaging exercised locally | Publish and validate the arm64 release assets |
| macOS Intel | Shared Electron/Node implementation present | Build and validate the x64 DMG on an Intel-compatible runner |
| Windows x64 | Shared Electron/Node implementation present | Build the EXE installer and validate process, PTY, filesystem, and sandbox behavior |
| Linux x64 | Shared Electron/Node implementation present | Build and validate Debian and RPM packages |
| Web | Available from source through `pnpm dsh web` | Continue sharing the same Harness services and configuration |

## Architecture

```mermaid
flowchart LR
    D["Electron desktop host"] --> W["Loopback Web client"]
    W --> H["Harness Host APIs"]
    H --> R["Cordis plugin runtime"]
    R --> M["Models + prompts"]
    R --> T["Tools + policy + sandbox"]
    R --> S["Sessions + storage"]
    R --> E["Plugins + Skills + workflows"]
```

DeepSeek Harness follows an **everything is a plugin** architecture powered by [Cordis](https://github.com/cordiverse/cordis). The desktop window does not become a second runtime: configuration, credentials, sessions, plugins, and Skills remain owned by Harness services. Start with the [architecture documentation](docs/architecture.md) and [development guide](docs/development.md) before changing packages.

## Plugins and Skills

The home and Settings surfaces expose plugin discovery and supported installation actions. Registry installation uses validated package specifications, explicit confirmation, streamed command output, and a restart-required result; it is not a generic shell prompt. Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to a compatible plugin repository so users can find it.

Skills remain managed through Harness providers and are invoked in the same session context as the rest of the agent. Plugin authors should use documented service definitions, providers, consumers, effects, and configuration instead of Electron-only state.

## Security and privacy

The renderer runs with Node integration disabled, context isolation enabled, and Chromium sandboxing enabled. Navigation is restricted to the exact loopback Harness origin, renderer permission requests are denied, and no generic command or filesystem bridge is exposed to Web content.

API keys remain owned by the Harness credentials service. Do not commit credentials. Before selecting any compatible provider, review its endpoint, model support, tool-calling behavior, pricing, rate limits, and data-handling terms.

## Project direction

- Produce reproducible macOS arm64/x64 DMG, Windows x64 EXE, and Linux x64 DEB/RPM releases with checksums and generated third-party notices.
- Improve plugin and Skill discovery, compatibility metadata, lifecycle management, and update visibility.
- Add native approvals, notifications, tray status, deep links, and an authenticated local control endpoint.
- Support WeChat, Discord, Slack, and other IM control through separate authenticated transport plugins with identity mapping, authorization, audit events, rate limits, and revocation.

These items describe direction, not completed support. See the [desktop release matrix](apps/desktop/README.md#cross-platform-release-matrix) for the current implementation boundary.

## Documentation and community

- Read the [user guide](docs/user/guide/index.md), [plugin introduction](docs/user/develop/framework/index.md), and [Skill guide](docs/subsystems/skills.md).
- Use [GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues) for reproducible bugs and feature requests.
- Discuss the upstream runtime in [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) or its [Discord community](https://discord.gg/Ycq5dCaS4).
- See [CONTRIBUTING.md](CONTRIBUTING.md) before contributing and [AGENTS.md](AGENTS.md) when working with coding agents in this repository.

## About FLAQ.AI

[FLAQ.AI](https://flaq.ai/) provides access to image, video, audio, and language models through APIs, documentation, and developer-oriented workflows. It can be evaluated as an optional compatible provider or companion platform where its current API and model capabilities fit a project.

FLAQ.AI is not required to run this repository, is not configured as a hidden default, and does not imply endorsement by DeepSeek. Provider availability and commercial terms can change, so confirm current details in the [FLAQ.AI documentation](https://flaq.ai/docs/) before use.

## License

Open DeepSeek Harness Desktop is available under the [MIT License](LICENSE). Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
