<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop アイコン">
</p>

# Open DeepSeek Harness Desktop

<p align="center">
  <strong>すぐに使えて、依存関係の安全性を強化した DeepSeek Harness コミュニティデスクトップ版</strong>
</p>

言語：[简体中文](README.md) · [English](README.en.md) · 日本語 · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

> [!IMPORTANT]
>
> **[v0.1.2-rc.1 を公開しました。ぜひダウンロードしてお試しください](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1)。** 本版は DeepSeek Harness 0.1.2-rc.1 を上流の基盤とし、ネイティブアプリメニューと保護された再起動・終了フローを追加しました。macOS の Dock・メニューバーアイコンを改善し、Codex のシステムプロキシ適用範囲とカスタム Profile の起動互換性も修正しています。
>
> これは Release Candidate のプレリリースです。アップグレード前に重要な設定をバックアップし、問題を報告する際はログまたは診断レポートを添付してください。

Open DeepSeek Harness Desktop は、[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) を基盤とする、コミュニティ運営の独立したデスクトップ配布版です。Node.js、pnpm、Harness ランタイムをインストーラーに同梱し、モデル設定、コーディングセッション、実行履歴、プラグイン、Skill、外部コーディングツール、IM ボットを一つのアプリで扱えます。

> [!NOTE]
>
> 本リポジトリは DeepSeek の公式製品ではありません。現在もプレビュー段階であり、データ形式、互換性ポリシー、インストール方法は今後変更される可能性があります。

## 現在の主な機能

- 調整可能な本文、ターン移動、正確な Token 使用量、送信キューを備えた AI 会話ワークスペース。
- 公式設定の独立環境へのコピー、既存ディレクトリの共有、または新規作成。
- 実際の市場データ、カテゴリ、ローカル状態、直接インストールを使うプラグイン探索。
- pnpm、Cordis、Loader を起動前に検査する診断、演習、隔離、復元。
- スクロール、ドラッグによる並べ替え、順序保存に対応した設定ナビゲーション。
- Windows、macOS、Linux のネイティブ配布とデスクトップ統合。

## AI 会話ワークスペース

完了した回答では処理内容と System Prompt を折りたためます。本文幅と文字サイズを調整でき、Markdown 表、コンパクトなターン移動、回答ごとの正確な Token 使用量、ストリーミング中のコードハイライトが長い会話の確認を助けます。

質問履歴は完了、キャンセル、中断を区別するカードで表示されます。セッションを切り替えても未送信の質問は保持され、実行中にも次のメッセージを送信キューへ追加できます。画像はすぐに表示され、圧縮とアップロードはバックグラウンドで続行します。トレース内の画像、ローカルファイルの参照、編集後も維持されるファイル／セッション参照にも対応します。

## 初回起動と独立データ環境

初回起動時に既定の公式 DSH ディレクトリ ~/.dsh を確認します。見つからない場合や未対応の場合も、別の対応ディレクトリを手動で選択するか、空のデスクトップ専用環境を作成できます。

### 独立環境へインポート

設定、資格情報、セッション、ワークスペース情報、Agent プリセット、Skill、接続状態をデスクトップ専用ディレクトリへコピーし、元のディレクトリは変更しません。Profile、node_modules、ロックファイル、プラグイン実体、隔離記録、匿名識別子はコピーしません。プラグインはデスクトップ側で再インストールされ、その後の変更は公式 CLI/Web 環境と共有されません。

<p align="center">
  <img src="./assets/readme/data-home-import-en.png" width="900" alt="公式 DSH 設定を独立したデスクトップ環境へインポート">
  <br><sub>独立環境へインポート：対応データのみをコピーし、元の環境を維持</sub>
</p>

### この設定を直接使用

公式 ~/.dsh または手動で選択した対応ディレクトリをそのまま使用します。設定、資格情報、セッション、Agent プリセット、Skill、Profile、プラグインが共有され、Desktop と公式 CLI/Web の変更は同じデータへ反映されます。

<p align="center">
  <img src="./assets/readme/data-home-reuse-en.png" width="900" alt="既存 DSH 設定をデスクトップから直接使用">
  <br><sub>この設定を直接使用：選択したディレクトリとデータを共有</sub>
</p>

### 新しく開始

既存の設定、セッション、プラグインを読み込まず、完全に独立した空の環境を作成します。

<p align="center">
  <img src="./assets/readme/data-home-fresh-en.png" width="900" alt="新しい独立 DSH 環境を作成">
  <br><sub>新しく開始：既存 DSH 設定を読み取りも変更もしません</sub>
</p>

### 独立データディレクトリを自由に選択

「独立環境へインポート」と「新しく開始」は、続行前に管理された既定位置または空のカスタムフォルダを選択できます。選択した空フォルダがこのクライアント専用のデータルートになり、元の設定は変更も同期もされません。Windows では、増え続けるセッションやプラグイン Profile を D ドライブなどへ置き、C ドライブの負担を減らせます。

<p align="center"><img src="./assets/readme/data-home-import-custom-location-zh.png" width="900" alt="設定のインポート時に空のカスタムディレクトリを選択"><br><sub>独立インポート：コピー前に既定位置または空フォルダを選択</sub></p>

<p align="center"><img src="./assets/readme/data-home-fresh-custom-location-zh.png" width="900" alt="新しく開始するときに空のカスタムディレクトリを選択"><br><sub>新しく開始：独立データをユーザーが選んだ場所へ保存</sub></p>

初回設定の完了後も、**設定 → 一般設定** からデータディレクトリを切り替えられます。クライアント専用ディレクトリへ戻る、公式の `~/.dsh` を直接使用する、別の既存 DSH ディレクトリを選ぶ、または空フォルダに新しい設定を作成できます。切り替えは再起動後に使用するディレクトリを選ぶだけで、元のデータをコピー、移動、統合、削除しません。空フォルダを選ぶと、再起動後に初回インストール手順が再び始まります。

<p align="center"><img src="./assets/readme/data-home-switch-after-start-zh.png" width="900" alt="クライアント起動後に一般設定からデータディレクトリを切り替える"><br><sub>既存設定へ安全に切り替えるか、空フォルダに新しい独立設定を作成</sub></p>

セットアップウィザードでは、モデル API Key、スマートフォンアクセス、WeChat／Feishu などの IM ボット、任意の Codex 接続を設定できます。すべての手順はスキップでき、後から設定画面で完了できます。

## プラグインの探索、インストール、更新

「プラグインを探索」は固定リストではなく Plugin Marketplace の実データを読み込みます。人気順とカテゴリ別表示で Star、直近 30 日のダウンロード数、ローカルのインストール状態を確認でき、管理された直接インストールまたは市場の詳細画面へ進めます。

カタログは成功後 24 時間キャッシュされ、カテゴリ切り替えでは再取得しません。インストール状態は開くたびに更新され、手動更新も可能です。ネットワーク障害時は実際の理由を表示し、古いキャッシュがあれば期限切れを明示して閲覧を続けられます。ローカルから導入したプラグインも検証可能なパッケージ情報やリポジトリを保持するため、市場は対応するオンライン出所と「復元」を提示できます。ただしローカル出所自体は更新されず、通常の更新確認にはオンライン版への復元が必要です。

## インポート後のプラグイン復元

独立環境へのインポートでは、プラグイン設定と復元リストだけをコピーし、古い node_modules は採用しません。復元画面は各項目を次の状態で表示します。

- **クライアント提供済み**：同梱プリセットが既に満たしています。
- **確認中**：一時ディレクトリで出所を確認し、現在の Profile は変更しません。
- **オンライン復元可能**：同梱 pnpm で再インストールできます。
- **オンライン出所なし**：パッケージ、リポジトリ、Git 参照が存在しません。
- **一時的に確認不可**：オフライン、タイムアウト、認証、レート制限のため後で再試行できます。

オンライン出所が利用できない場合、ユーザーがソースディレクトリまたは .tgz を選択できます。クライアントはパッケージ名、アーカイブパス、manifest とファイルサイズを検証し、ソースはライフサイクルスクリプトを無効化して再パックします。オンライン／ローカルのどちらも、ビルド許可、共有依存関係診断、必要な隔離を通過します。旧 node_modules や資格情報を含む不明な依存 URL は直接実行しません。

<p align="center">
  <img src="./assets/readme/imported-plugin-restore-zh.png" width="900" alt="インポート後のプラグイン出所確認とローカル復元">
  <br><sub>プラグインの出所状態、オンライン復元、安全なローカル復元</sub>
</p>

## 強化された診断

第三者プラグインは Host と同じ Node.js プロセスおよび Cordis サービスグラフを共有します。推移依存関係、pnpm のリンク方式、古い Loader エントリだけでも、設定画面が開く前に空のツール呼び出し、.prepare エラー、プラグイン一覧消失を引き起こせます。

そのため診断は通常のプラグインではなく、Profile の構成・起動層で実行されます。第三者コードの実行前に manifest、pnpm-lock.yaml、Workspace 設定、Bundle 順序、実際の依存グラフ、同梱 Host ランタイムを読み取ります。

### 起動時の隔離から実行可能な修復まで

保護は起動とメイン画面を通して続きます。起動層が非互換プラグインを検出して外し、クライアントが隔離結果を通知し、診断画面が原因、元のバージョン、更新または削除の操作を提示します。

<p align="center"><img src="./assets/readme/diagnostics-startup-quarantine-zh.png" width="900" alt="起動中に非互換 dsh-font を隔離"><br><sub>起動段階で非互換プラグインを検出して隔離</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-quarantine-notice-zh.png" width="900" alt="起動後に隔離結果を通知"><br><sub>安全にメイン画面へ入り、隔離結果を明示</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-repair-guidance-zh.png" width="900" alt="診断画面に原因と修復操作を表示"><br><sub>原因、バージョン、元の導入元、実行可能な修復を表示</sub></p>

Cordis の Context、Service、Symbol はバージョン番号だけでなく物理モジュールの同一性に依存します。同じバージョンでも別 real path にある @deepseek-ai/cordis や dsh-tools は別インスタンスです。診断は各ルートプラグインから直接・間接依存をたどり、宣言範囲と解決先を比較します。正しい peerDependencies は誤検出しません。

確認対象には、共有 Host の単一性、Profile とロックファイルの整合性、孤立／重複 Bundle、幽霊プラグイン、pnpm Store、未完了インストール、allowBuilds、prepare 許可、peer 重複排除設定が含まれます。

修復順序は **読み取り専用検査 → 無損失の収束 → 必要な依存だけ再インストール → real path 再検査 → 必要時に隔離** です。健全な Profile では pnpm を実行しません。互換範囲では管理対象の link: override を使いますが、minimumReleaseAge や明示的な allowBuilds: false を緩めません。pnpm が成功しても、物理パスと Loader 状態の再検査に通るまで起動しません。

安全に統一できない場合は、原因となるルートプラグインだけを活動依存と Bundle 順序から外し、元の仕様、バージョン、依存経路、理由、時刻を保存します。物理パッケージが Profile から除かれ、共有 Host が標準コピーを指し、再検査に成功して初めて隔離完了です。つまり、問題を推測で再インストールするのではなく、「誰が、なぜ失敗し、どの保護を適用し、次に何をすべきか」を示します。

診断画面には責任プラグイン、バージョン、隔離理由、依存チェーンの概要が表示されます。再リンクと復元、診断が特定したビルド項目の承認、市場での互換更新検索、完全アンインストールを選択できます。復元後も同じ検査を通過するまでプラグインは再び有効になりません。

### 診断演習センター

開発版とインストール版は、オフラインの固定サンプルで Host の別コピー、孤立 Bundle、欠落モジュール、無効 Patch、重複 Loader、ライフサイクル失敗、ビルド許可、修復中断を再現できます。選択したシナリオを順番に実行し、現在のシナリオ、段階、残りのシナリオ、成否、所要時間を表示します。既定の隔離モードはユーザー Profile を変更せず、高度な実 Profile モードは終了時に復元と再検査を行います。安全な復元を確認できない場合は Profile プラグインを再起動せず、匿名化した JSON／テキスト概要を保存し、JSON レポートを出力できます。

<p align="center"><img src="./assets/readme/diagnostics-lab-sandbox-zh.png" width="900" alt="診断演習センターの隔離サンドボックス"><br><sub>隔離サンドボックス：ユーザー Profile を変更せず複数の障害を演習</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-lab-live-profile-zh.png" width="900" alt="診断演習センターの実 Profile モード"><br><sub>高度な実 Profile 演習：実際の隔離、復元、再検査を確認</sub></p>

> [!CAUTION]
>
> このリリースでは、実 Profile 演習が必ず成功するとは限りません。クラッシュする危険性が高いため、事前に設定をバックアップするか、隔離したデータディレクトリを使用してください。このモードを本番環境で使用しないでください。実環境での確認が必要な場合も、一度に有効にするシナリオは 1 件だけにしてください。

## テキスト選択と右クリックメニュー

会話、ツール出力、詳細、ファイルプレビューなどの読み取り専用テキストを選択すると横型ツールバーが表示され、選択部分を右クリックすると縦型の角丸メニューが表示されます。

- **コピー**：選択テキストをクリップボードへコピー。
- **新しい会話で質問**：現在のワークスペースに新しい会話を作り、質問文を入力しますが自動送信しません。
- **現在の会話へ追加**：既存の下書きを上書きせず Markdown 引用として追記。

現在の会話が確認や選択を待っていて入力欄が無効な場合、「現在の会話へ追加」は非表示になります。

<p align="center">
  <strong>選択ツールバー</strong><br>
  <img src="./assets/readme/selection-toolbar-zh.png" width="900" alt="選択後の横型ツールバー">
</p>

<p align="center">
  <strong>右クリックメニュー</strong><br>
  <img src="./assets/readme/selection-context-menu-zh.png" width="900" alt="選択テキストの縦型右クリックメニュー">
</p>

## デスクトップ体験

- トレイ常駐と完全終了、macOS メニューバー／Windows・Linux トレイからのクイック再起動。
- 起動失敗・復旧通知、固定 Harness ログへの入口、15 秒以上の起動待機表示。
- 一般設定から Release を確認・ダウンロードし、SHA256SUMS を検証してインストーラーを開く機能。
- 同梱 dsh コマンドのシステム PATH への安全な登録と削除。
- Windows／Linux のカスタムタイトルバー、macOS のネイティブ挙動、制限付きクリップボード書き込み。
- Codex と Claude Code は同梱せず、設定 → 外部ツールから必要な公式パッケージだけをオンライン導入します。

### プリセットプラグイン

インストーラーには、Plugin Marketplace、dsh-im、dsh-skill-picker、Better Sidebar、dsh-pocket の 5 つの起動プリセットが、整合性を検証したローカルアーカイブとして含まれます。`dsh-font` は診断演習用サンプルとしてのみ提供されます。ユーザーがプリセットをアンインストールしても、クライアントが自動で戻すことはありません。

<p align="center"><img src="./assets/readme/preset-mobile-access-zh.png" width="900" alt="Pocket の QR コードまたは LAN アドレスでスマートフォンを接続"><br><sub>スマートフォンアクセス：同じネットワークでスキャンし、必要に応じて公開アクセスも有効化</sub></p>

<p align="center"><img src="./assets/readme/preset-im-robot-zh.png" width="900" alt="dsh-im で WeChat などの IM ボットを接続"><br><sub>IM ボット：WeChat、Feishu、DingTalk、WeCom、QQ、Slack、Telegram、Discord、WhatsApp に接続</sub></p>

インストーラー内のローカル版はオフライン準備に便利ですが、市場更新には直接追随しません。オンラインになったら **プラグイン市場 → インストール済み** で各プリセットの **復元** を選び、オンライン版へ入れ替えることを推奨します。復元は自動ロールバックできないため、固定されたオフライン版を優先する場合はそのまま維持できます。

<p align="center"><img src="./assets/readme/preset-plugin-restore-online-zh.png" width="900" alt="ローカルのプリセットをオンライン版へ復元"><br><sub>推奨：オンライン時に「復元」を押し、通常の更新確認が可能なオンライン版へ切り替え</sub></p>

### 設定ナビゲーションのカスタマイズ

設定の左側ナビゲーションは独立してスクロールでき、項目が増えても後半が隠れません。項目はドラッグで並べ替えでき、順序はローカルに保存されます。プラグインの追加・削除後もユーザーの並びへ安定して統合されます。Windows／Linux ではタイトルバーと Harness 内容を別のネイティブビューに分けるため、全画面プラグインがウィンドウ操作ボタンを覆いません。

<p align="center"><img src="./assets/readme/settings-navigation-reorder-zh.png" width="900" alt="三本線のハンドルで設定ナビゲーションを並べ替え"><br><sub>設定項目を自由にドラッグし、周囲の行が滑らかに場所を空け、最終順序を保存</sub></p>

## テーマと背景

システム、ライト、ダーク、8 種類の製品テーマ、8 枚の内蔵イラスト、ローカル PNG/JPEG/WebP 背景に対応します。カスタム画像はローカルブラウザストレージだけに保存され、モデルへ送信されません。

<table>
  <tr><th width="50%">テーマ</th><th width="50%">背景</th></tr>
  <tr>
    <td align="center"><img src="./assets/readme/theme-settings-en.png" alt="テーマ設定"></td>
    <td align="center"><img src="./assets/readme/background-settings-en.png" alt="背景設定"></td>
  </tr>
</table>

## ダウンロードとインストール

[GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1) から対象パッケージを入手してください。

| OS | アーキテクチャ | パッケージ |
| --- | --- | --- |
| macOS | Apple Silicon arm64 | DeepSeek-Harness-macos-arm64.dmg |
| macOS | Intel x64 | DeepSeek-Harness-macos-x64.dmg |
| Windows | x64 | DeepSeek-Harness-windows-x64.exe |
| Linux | Debian / Ubuntu x64 | DeepSeek-Harness-linux-x64.deb |
| Linux | Fedora / RHEL x64 | DeepSeek-Harness-linux-x64.rpm |

SHA256SUMS で完全性を確認してください。macOS 版は ad-hoc 署名で未公証です。Gatekeeper が阻止した場合は「システム設定 → プライバシーとセキュリティ → このまま開く」を使用してください。Windows では未署名・新規公開アプリの評価警告が出る場合があります。

## ソースから実行

Node.js ^22.19.0 または 24 以降と pnpm 11.7.0 を用意し、次を実行します。

    git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
    cd open-deepseek-harness-desktop
    pnpm install
    pnpm run build
    pnpm run dev:desktop

Web のみの場合は pnpm dsh web を使用します。ソース Web は現在の DSH_HOME（未設定なら通常 ~/.dsh）を使用します。インストール版 Desktop は初回起動で選んだディレクトリを使用するため、データ共有の有無はその選択で決まります。

## セキュリティ、コミュニティ、ライセンス

Renderer は Node 統合を無効化し、context isolation と Chromium sandbox を有効化しています。ナビゲーションは Harness の正確な loopback origin に限定され、任意コマンド、ファイル、URL を扱う汎用 bridge は提供しません。API Key は Harness の資格情報サービスで管理してください。

- [ユーザーガイド](docs/user/guide/index.md)、[プラグインガイド](docs/user/develop/framework/index.md)、[Skill ガイド](docs/subsystems/skills.md)
- 不具合と提案：[GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues)
- 上流：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Open DeepSeek Harness Desktop は [MIT License](LICENSE) で公開されています。第三者ライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

## Friends

- [DSHFind](https://dshfind.com/zh) — DeepSeek Harness の中国語学習・共有コミュニティ。
