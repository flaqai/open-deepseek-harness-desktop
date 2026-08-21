<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop アイコン">
</p>

<h1 align="center">Open DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>すぐに使えて、依存関係にも配慮した DeepSeek Harness デスクトップ版</strong>
</p>

言語：[English](README.md) · [简体中文](README.zh.md) · 日本語 · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

Open DeepSeek Harness Desktop は、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) を macOS、Windows、Linux で使いやすくする、コミュニティ運営の独立したデスクトップ配布版です。Electron は別の Agent ランタイムを作るのではなく、ローカルの Harness Host を安全に起動・監視し、既存の Web クライアントを表示します。

本プロジェクトは DeepSeek の公式製品ではありません。現在も活発に開発されており、機能、パッケージ形式、ローカルデータ形式が変更される可能性があります。

## 主な特長

- Harness の起動監視、トレイ、通知、ログ表示、起動失敗時の再試行を備えたデスクトップホスト。
- プラグイン実行前に依存関係の競合を検出し、修復できないプラグインだけを隔離する安全レイヤー。
- プラグインマーケット、IM 接続、Skill 選択を初回起動時に導入。すべて後から削除可能です。
- 公式 Codex Provider と対象 OS・CPU に一致する Codex ランタイムを同梱。
- 11 種類のテーマ、チャット背景、ローカル画像アップロード、言語・モデル設定。
- WeChat、Feishu、DingTalk、WeCom、QQ、Slack、Telegram、Discord、WhatsApp との接続。
- Apple Silicon / Intel macOS、Windows x64、Linux x64 向けの独立したパッケージ。

## インストール

最新の対応パッケージは [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases) から入手してください。macOS 版は ad-hoc 署名で公証されていないため、初回起動時に Gatekeeper の警告が表示される場合があります。ダウンロード元を確認してから、リリースページの手順に従ってください。

## 無料で試せる API Token

- [Agnes AI](https://agnes-ai.com/)：OpenAI 互換の Base URL は `https://apihub.agnes-ai.com/v1`、Agent やコーディング用途の候補モデルは `agnes-2.5-flash` です。
- [OpenRouter · Ox Alpha](https://openrouter.ai/stealth/ox-alpha?view=api)：Base URL は `https://openrouter.ai/api/v1`、モデル ID は `stealth/ox-alpha` です。

いずれも独立した第三者サービスです。無料枠、価格、モデル名、レート制限、データ取扱条件は変更される可能性があります。API Key は Harness の認証情報ストアに保存し、Issue、スクリーンショット、Git 管理ファイルには記載しないでください。

## ドキュメント

完全な機能説明、セキュリティ境界、パッケージ構成、プラグイン作者への謝辞は [English README](README.md) または [简体中文 README](README.zh.md) を参照してください。Harness 自体の設計は[公式アーキテクチャ文書](docs/architecture.md)にあります。

## FLAQ AI チームについて

本プロジェクトは、モデル統合、ローカル Agent 環境、プラグイン配布、クロスプラットフォームアプリ開発の実務経験をもとに FLAQ AI チームが保守しています。[FLAQ.AI](https://flaq.ai/) は AI Agent とプロダクションアプリ向けに、画像、動画、音楽、言語モデルへの統一 API アクセスを提供します。FLAQ.AI の利用は任意であり、本ソフトウェアの実行には必要ありません。

## ライセンス

[MIT License](LICENSE)。第三者依存関係のライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
