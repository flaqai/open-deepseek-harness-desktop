/** Download-network copy for the community desktop languages. */

import type { DesktopShellKey } from './locales.ts'

type NetworkDictionary = Partial<Record<DesktopShellKey, string>>

const ja = {
  'network.loading': 'ダウンロード設定を読み込み中…', 'network.title': 'ダウンロードとプロキシ',
  'network.description': 'アプリ更新と Desktop が実行する npm パッケージのダウンロードを管理します。マーケットのカタログ、README、ソースアーカイブ、Git 操作は既存のネットワーク設定を使用します。',
  'network.application.title': 'アプリの更新', 'network.application.description': '更新確認とインストーラーの取得元を選びます。失敗時に取得元を自動変更しません。',
  'network.application.source.github': 'GitHub', 'network.application.source.cnb': 'CNB（中国）', 'network.source': 'ダウンロード元',
  'network.proxy': 'プロキシ方式', 'network.proxy.system': 'システムプロキシ', 'network.proxy.existing': '現在の設定を維持',
  'network.proxy.direct': '直接接続', 'network.proxy.custom': 'カスタムプロキシ', 'network.proxy.url': 'プロキシサーバー',
  'network.proxy.username': 'ユーザー名（任意）', 'network.proxy.password': 'パスワード（任意）', 'network.proxy.password.saved': '安全に保存済み。空欄なら変更しません',
  'network.npm.title': 'npm ダウンロード', 'network.npm.description': '外部ツールなど、Desktop が管理する npm パッケージのインストールに使用します。既定は npmmirror で、private scope とビルド拒否は維持されます。',
  'network.npm.registry.npmjs': 'npm 公式', 'network.npm.registry.npmmirror': 'npmmirror',
  'network.npm.registry.custom': 'カスタム registry', 'network.registry': 'npm registry', 'network.registry.url': 'Registry URL',
  'network.github.title': 'GitHub プラグイン', 'network.github.description': 'マーケット情報、README、ソースアーカイブ、Git HTTPS に使用します。',
  'network.github.route': 'ダウンロード先', 'network.github.download.original': 'GitHub の元アドレス', 'network.github.download.custom': 'カスタム高速化プレフィックス',
  'network.github.accelerator': '高速化プレフィックス', 'network.github.ssh': 'Git SSH は既存の SSH 設定を使用します。HTTP プロキシは SSH を上書きしません。対応するマーケットはここで管理されます。',
  'network.test': '接続をテスト', 'network.save': '保存', 'network.reset': '既定に戻す', 'network.test.testing': 'メタデータと小さなダウンロードを個別に確認中…',
  'network.test.success': '接続成功（{ms} ミリ秒）', 'network.test.failed': '接続失敗：{message}',
  'release.download.switchSource': '取得元を切り替えて再試行',
} satisfies NetworkDictionary

const ko = {
  'network.loading': '다운로드 설정을 불러오는 중…', 'network.title': '다운로드 및 프록시',
  'network.description': '앱 업데이트와 Desktop에서 실행하는 npm 패키지 다운로드를 관리합니다. 마켓 카탈로그, README, 소스 아카이브 및 Git 작업은 기존 네트워크 설정을 사용합니다.',
  'network.application.title': '앱 업데이트', 'network.application.description': '업데이트 확인 및 설치 파일 출처를 선택합니다. 실패해도 출처를 자동 전환하지 않습니다.',
  'network.application.source.github': 'GitHub', 'network.application.source.cnb': 'CNB(중국)', 'network.source': '다운로드 출처',
  'network.proxy': '프록시 방식', 'network.proxy.system': '시스템 프록시', 'network.proxy.existing': '현재 설정 유지',
  'network.proxy.direct': '직접 연결', 'network.proxy.custom': '사용자 지정 프록시', 'network.proxy.url': '프록시 서버',
  'network.proxy.username': '사용자 이름(선택)', 'network.proxy.password': '비밀번호(선택)', 'network.proxy.password.saved': '안전하게 저장됨. 비워 두면 유지됩니다',
  'network.npm.title': 'npm 다운로드', 'network.npm.description': '외부 도구 등 Desktop에서 관리하는 npm 패키지 설치에 사용합니다. 기본값은 npmmirror이며 비공개 scope와 빌드 거부는 유지됩니다.',
  'network.npm.registry.npmjs': '공식 npm', 'network.npm.registry.npmmirror': 'npmmirror',
  'network.npm.registry.custom': '사용자 지정 registry', 'network.registry': 'npm registry', 'network.registry.url': 'Registry 주소',
  'network.github.title': 'GitHub 플러그인', 'network.github.description': '마켓 메타데이터, README, 소스 아카이브와 Git HTTPS에 사용합니다.',
  'network.github.route': '다운로드 주소', 'network.github.download.original': 'GitHub 원본 주소', 'network.github.download.custom': '사용자 지정 가속 접두사',
  'network.github.accelerator': '가속 접두사', 'network.github.ssh': 'Git SSH는 기존 SSH 설정을 계속 사용하며 HTTP 프록시는 SSH를 대체하지 않습니다. 호환 마켓 버전은 여기서 관리됩니다.',
  'network.test': '연결 테스트', 'network.save': '저장', 'network.reset': '기본값 복원', 'network.test.testing': '메타데이터와 소형 다운로드를 각각 확인하는 중…',
  'network.test.success': '연결 성공({ms}ms)', 'network.test.failed': '연결 실패: {message}',
  'release.download.switchSource': '출처를 전환하고 다시 시도',
} satisfies NetworkDictionary

const es = {
  'network.loading': 'Cargando ajustes de descarga…', 'network.title': 'Descargas y proxy',
  'network.description': 'Administra las actualizaciones de la aplicación y las descargas de paquetes npm ejecutadas por Desktop. Los catálogos, README, archivos de código y operaciones Git del mercado conservan su configuración de red actual.',
  'network.application.title': 'Actualizaciones de la aplicación', 'network.application.description': 'Elige el origen de las comprobaciones y los instaladores. No se cambia en silencio si falla.',
  'network.application.source.github': 'GitHub', 'network.application.source.cnb': 'CNB (China)', 'network.source': 'Origen de descarga',
  'network.proxy': 'Modo de proxy', 'network.proxy.system': 'Proxy del sistema', 'network.proxy.existing': 'Mantener configuración actual',
  'network.proxy.direct': 'Conexión directa', 'network.proxy.custom': 'Proxy personalizado', 'network.proxy.url': 'Servidor proxy',
  'network.proxy.username': 'Usuario (opcional)', 'network.proxy.password': 'Contraseña (opcional)', 'network.proxy.password.saved': 'Guardada de forma segura; déjala vacía para conservarla',
  'network.npm.title': 'Descargas npm', 'network.npm.description': 'Para herramientas externas y otras instalaciones de paquetes npm administradas por Desktop. npmmirror es el valor predeterminado; se conservan los scopes privados y los bloqueos de compilación.',
  'network.npm.registry.npmjs': 'npm oficial', 'network.npm.registry.npmmirror': 'npmmirror',
  'network.npm.registry.custom': 'Registry personalizado', 'network.registry': 'npm registry', 'network.registry.url': 'URL del registry',
  'network.github.title': 'Plugins de GitHub', 'network.github.description': 'Para metadatos del mercado, README, archivos de código y Git HTTPS.',
  'network.github.route': 'Dirección de descarga', 'network.github.download.original': 'Dirección original de GitHub', 'network.github.download.custom': 'Prefijo acelerador personalizado',
  'network.github.accelerator': 'Prefijo acelerador', 'network.github.ssh': 'Git SSH sigue usando tu configuración SSH; el proxy HTTP no la reemplaza. Las versiones compatibles del mercado se administran aquí.',
  'network.test': 'Probar conexión', 'network.save': 'Guardar', 'network.reset': 'Restaurar', 'network.test.testing': 'Comprobando por separado metadatos y una descarga pequeña…',
  'network.test.success': 'Conexión correcta ({ms} ms)', 'network.test.failed': 'Error de conexión: {message}',
  'release.download.switchSource': 'Cambiar de origen y reintentar',
} satisfies NetworkDictionary

const fr = {
  'network.loading': 'Chargement des réglages de téléchargement…', 'network.title': 'Téléchargements et proxy',
  'network.description': 'Gère les mises à jour de l’application et les téléchargements de paquets npm exécutés par Desktop. Les catalogues, README, archives source et opérations Git du marché conservent sa configuration réseau actuelle.',
  'network.application.title': 'Mises à jour de l’application', 'network.application.description': 'Choisissez la source des vérifications et installateurs. Elle ne change jamais discrètement en cas d’échec.',
  'network.application.source.github': 'GitHub', 'network.application.source.cnb': 'CNB (Chine)', 'network.source': 'Source de téléchargement',
  'network.proxy': 'Mode proxy', 'network.proxy.system': 'Proxy système', 'network.proxy.existing': 'Conserver la configuration',
  'network.proxy.direct': 'Connexion directe', 'network.proxy.custom': 'Proxy personnalisé', 'network.proxy.url': 'Serveur proxy',
  'network.proxy.username': 'Nom d’utilisateur (facultatif)', 'network.proxy.password': 'Mot de passe (facultatif)', 'network.proxy.password.saved': 'Enregistré de façon sécurisée ; laissez vide pour le conserver',
  'network.npm.title': 'Téléchargements npm', 'network.npm.description': 'Pour les outils externes et les autres installations de paquets npm gérées par Desktop. npmmirror est la valeur par défaut ; les scopes privés et refus de build sont conservés.',
  'network.npm.registry.npmjs': 'npm officiel', 'network.npm.registry.npmmirror': 'npmmirror',
  'network.npm.registry.custom': 'Registry personnalisé', 'network.registry': 'npm registry', 'network.registry.url': 'URL du registry',
  'network.github.title': 'Plugins GitHub', 'network.github.description': 'Pour les métadonnées du marché, README, archives source et Git HTTPS.',
  'network.github.route': 'Adresse de téléchargement', 'network.github.download.original': 'Adresse GitHub d’origine', 'network.github.download.custom': 'Préfixe d’accélération personnalisé',
  'network.github.accelerator': 'Préfixe d’accélération', 'network.github.ssh': 'Git SSH continue d’utiliser votre configuration SSH ; le proxy HTTP ne la remplace pas. Les versions compatibles du marché sont gérées ici.',
  'network.test': 'Tester la connexion', 'network.save': 'Enregistrer', 'network.reset': 'Réinitialiser', 'network.test.testing': 'Vérification séparée des métadonnées et d’un petit téléchargement…',
  'network.test.success': 'Connexion réussie ({ms} ms)', 'network.test.failed': 'Échec de la connexion : {message}',
  'release.download.switchSource': 'Changer de source et réessayer',
} satisfies NetworkDictionary

const de = {
  'network.loading': 'Download-Einstellungen werden geladen…', 'network.title': 'Downloads und Proxy',
  'network.description': 'Verwaltet Anwendungsupdates und von Desktop ausgeführte npm-Paketdownloads. Kataloge, READMEs, Quellarchive und Git-Vorgänge des Marktplatzes verwenden weiterhin dessen bestehende Netzwerkkonfiguration.',
  'network.application.title': 'Anwendungsupdates', 'network.application.description': 'Quelle für Updateprüfung und Installationsdateien wählen. Bei Fehlern wird sie nicht unbemerkt gewechselt.',
  'network.application.source.github': 'GitHub', 'network.application.source.cnb': 'CNB (China)', 'network.source': 'Download-Quelle',
  'network.proxy': 'Proxy-Modus', 'network.proxy.system': 'System-Proxy', 'network.proxy.existing': 'Bestehende Konfiguration beibehalten',
  'network.proxy.direct': 'Direkte Verbindung', 'network.proxy.custom': 'Benutzerdefinierter Proxy', 'network.proxy.url': 'Proxyserver',
  'network.proxy.username': 'Benutzername (optional)', 'network.proxy.password': 'Passwort (optional)', 'network.proxy.password.saved': 'Sicher gespeichert; leer lassen, um es beizubehalten',
  'network.npm.title': 'npm-Downloads', 'network.npm.description': 'Für externe Werkzeuge und andere von Desktop verwaltete npm-Paketinstallationen. npmmirror ist die Voreinstellung; private Scopes und Build-Sperren bleiben erhalten.',
  'network.npm.registry.npmjs': 'Offizielle npm-Registry', 'network.npm.registry.npmmirror': 'npmmirror',
  'network.npm.registry.custom': 'Benutzerdefinierte Registry', 'network.registry': 'npm-Registry', 'network.registry.url': 'Registry-Adresse',
  'network.github.title': 'GitHub-Plugins', 'network.github.description': 'Für Marktplatz-Metadaten, READMEs, Quellarchive und Git über HTTPS.',
  'network.github.route': 'Download-Adresse', 'network.github.download.original': 'Originale GitHub-Adresse', 'network.github.download.custom': 'Benutzerdefiniertes Beschleuniger-Präfix',
  'network.github.accelerator': 'Beschleuniger-Präfix', 'network.github.ssh': 'Git SSH verwendet weiterhin Ihre SSH-Konfiguration; der HTTP-Proxy ersetzt sie nicht. Kompatible Marktplatzversionen werden hier verwaltet.',
  'network.test': 'Verbindung testen', 'network.save': 'Speichern', 'network.reset': 'Standard wiederherstellen', 'network.test.testing': 'Metadaten und kleinen Download getrennt prüfen…',
  'network.test.success': 'Verbindung erfolgreich ({ms} ms)', 'network.test.failed': 'Verbindung fehlgeschlagen: {message}',
  'release.download.switchSource': 'Quelle wechseln und erneut versuchen',
} satisfies NetworkDictionary

const ptBR = {
  'network.loading': 'Carregando configurações de download…', 'network.title': 'Downloads e proxy',
  'network.description': 'Gerencia as atualizações do aplicativo e os downloads de pacotes npm executados pelo Desktop. Catálogos, READMEs, arquivos de código e operações Git do mercado continuam usando a configuração de rede atual.',
  'network.application.title': 'Atualizações do aplicativo', 'network.application.description': 'Escolha a origem das verificações e instaladores. Uma falha nunca troca a origem silenciosamente.',
  'network.application.source.github': 'GitHub', 'network.application.source.cnb': 'CNB (China)', 'network.source': 'Origem do download',
  'network.proxy': 'Modo do proxy', 'network.proxy.system': 'Proxy do sistema', 'network.proxy.existing': 'Manter configuração existente',
  'network.proxy.direct': 'Conexão direta', 'network.proxy.custom': 'Proxy personalizado', 'network.proxy.url': 'Servidor proxy',
  'network.proxy.username': 'Nome de usuário (opcional)', 'network.proxy.password': 'Senha (opcional)', 'network.proxy.password.saved': 'Salva com segurança; deixe em branco para manter',
  'network.npm.title': 'Downloads npm', 'network.npm.description': 'Usado para ferramentas externas e outras instalações de pacotes npm gerenciadas pelo Desktop. npmmirror é o padrão; escopos privados e bloqueios de build são preservados.',
  'network.npm.registry.npmjs': 'npm oficial', 'network.npm.registry.npmmirror': 'npmmirror',
  'network.npm.registry.custom': 'Registry personalizado', 'network.registry': 'npm registry', 'network.registry.url': 'URL do registry',
  'network.github.title': 'Plugins do GitHub', 'network.github.description': 'Usado para metadados do mercado, READMEs, arquivos de código e Git HTTPS.',
  'network.github.route': 'Endereço de download', 'network.github.download.original': 'Endereço original do GitHub', 'network.github.download.custom': 'Prefixo acelerador personalizado',
  'network.github.accelerator': 'Prefixo acelerador', 'network.github.ssh': 'O Git SSH continua usando sua configuração SSH; o proxy HTTP não substitui o SSH. Versões compatíveis do mercado são gerenciadas aqui.',
  'network.test': 'Testar conexão', 'network.save': 'Salvar', 'network.reset': 'Restaurar padrão', 'network.test.testing': 'Verificando metadados e um download pequeno separadamente…',
  'network.test.success': 'Conexão bem-sucedida ({ms} ms)', 'network.test.failed': 'Falha na conexão: {message}',
  'release.download.switchSource': 'Trocar a origem e tentar novamente',
} satisfies NetworkDictionary

/** Localized desktop-shell additions keyed by every community locale. */
export const DOWNLOAD_NETWORK_TRANSLATIONS = { ja, ko, es, fr, de, 'pt-BR': ptBR } as const
