/** NAS runtime settings copy for every community desktop locale. */

import type { DesktopShellKey } from './locales.ts'

type NasDictionary = Partial<Record<DesktopShellKey, string>>

const es = {
  'nas.nav': 'NAS (Beta)', 'nas.title': 'NAS (Beta)', 'nas.experimental': 'Experimental · Beta',
  'nas.experimentalNotice': 'Esta función sigue en pruebas; el protocolo, el despliegue y la compatibilidad pueden cambiar. Haz una copia de /config y /workspaces antes del primer uso y no conserves todavía la única copia de datos importantes en el NAS.',
  'nas.description': 'Ejecuta tareas en este equipo o conecta Harness a un NAS. El NAS comparte plugins, modelos, historial y espacios de trabajo; la ventana, el tema, las notificaciones y las descargas permanecen en este dispositivo.',
  'nas.secureStorageUnavailable': 'El almacenamiento seguro del sistema no está disponible. Desktop no guardará credenciales NAS sin cifrar. Activa primero el llavero o gestor de credenciales.',
  'nas.local.title': 'Harness local', 'nas.local.description': 'Usa el directorio de datos y el entorno de este equipo. Cambiar de entorno reinicia Desktop sin mover ni borrar datos.',
  'nas.current': 'Entorno actual', 'nas.available': 'Disponible', 'nas.useLocal': 'Cambiar a local', 'nas.selected': 'Conectar al iniciar', 'nas.saved': 'Guardado',
  'nas.fingerprint': 'SHA-256 del certificado', 'nas.test': 'Probar conexión', 'nas.test.success': 'Conexión correcta · NAS {version}',
  'nas.connect': 'Conectar y reiniciar', 'nas.remove': 'Eliminar', 'nas.devices': 'Administrar dispositivos', 'nas.devices.title': 'Dispositivos vinculados',
  'nas.devices.expires': 'Caduca el {date}', 'nas.devices.revoke': 'Revocar', 'nas.devices.empty': 'No hay dispositivos vinculados.',
  'nas.add.title': 'Vincular un NAS', 'nas.add.description': 'Introduce el origen HTTPS exclusivo del NAS y el código de ocho dígitos del registro del contenedor. El primer contacto exige comprobar la huella del certificado.',
  'nas.address': 'Dirección HTTPS del NAS', 'nas.address.placeholder': 'Por ejemplo: https://harness.example.com', 'nas.deviceName': 'Nombre de este dispositivo', 'nas.code': 'Código de ocho dígitos',
  'nas.inspect': 'Examinar certificado', 'nas.inspecting': 'Examinando…', 'nas.confirmCertificate': 'Compara esta huella SHA-256 con la administración del NAS o el registro del contenedor:',
  'nas.trustCertificate': 'He comparado el certificado por un canal fiable y confío en él', 'nas.pair': 'Confiar y vincular', 'nas.pairing': 'Vinculando…',
  'nas.paired': 'Dispositivo vinculado. Elige «Conectar y reiniciar» para ejecutar tareas en el NAS.',
  'nas.discovery.search': 'Buscar NAS en la red', 'nas.discovery.searching': 'Buscando…', 'nas.discovery.title': 'NAS encontrados',
  'nas.discovery.empty': 'No se encontró ningún NAS en esta red. Puedes escribir su dirección HTTPS manualmente.',
  'nas.discovery.untrusted': 'El descubrimiento solo sugiere una dirección y no establece confianza. Aún debes verificar el certificado y vincular el dispositivo.',
} satisfies NasDictionary

const fr = {
  'nas.nav': 'NAS (Beta)', 'nas.title': 'NAS (Beta)', 'nas.experimental': 'Expérimental · Beta',
  'nas.experimentalNotice': 'Cette fonction est encore en test ; le protocole, le déploiement et la compatibilité peuvent évoluer. Sauvegardez /config et /workspaces avant la première utilisation et ne conservez pas encore l’unique copie de données importantes sur le NAS.',
  'nas.description': 'Exécutez les tâches sur cet ordinateur ou connectez Harness à un NAS. Le NAS partage plugins, modèles, historique et espaces de travail ; la fenêtre, le thème, les notifications et les téléchargements restent sur cet appareil.',
  'nas.secureStorageUnavailable': 'Le stockage sécurisé du système est indisponible. Desktop n’enregistrera pas les identifiants NAS en clair. Activez d’abord le trousseau ou le gestionnaire d’identifiants.',
  'nas.local.title': 'Harness local', 'nas.local.description': 'Utilisez le répertoire de données et l’environnement de cet ordinateur. Changer d’environnement redémarre Desktop sans déplacer ni supprimer les données.',
  'nas.current': 'Environnement actuel', 'nas.available': 'Disponible', 'nas.useLocal': 'Passer en local', 'nas.selected': 'Connexion au prochain démarrage', 'nas.saved': 'Enregistré',
  'nas.fingerprint': 'SHA-256 du certificat', 'nas.test': 'Tester la connexion', 'nas.test.success': 'Connexion réussie · NAS {version}',
  'nas.connect': 'Connecter et redémarrer', 'nas.remove': 'Supprimer', 'nas.devices': 'Gérer les appareils', 'nas.devices.title': 'Appareils associés',
  'nas.devices.expires': 'Expire le {date}', 'nas.devices.revoke': 'Révoquer', 'nas.devices.empty': 'Aucun appareil associé.',
  'nas.add.title': 'Associer un NAS', 'nas.add.description': 'Saisissez l’origine HTTPS dédiée du NAS et le code à huit chiffres du journal du conteneur. Le premier contact exige de vérifier l’empreinte du certificat.',
  'nas.address': 'Adresse HTTPS du NAS', 'nas.address.placeholder': 'Par exemple : https://harness.example.com', 'nas.deviceName': 'Nom de cet appareil', 'nas.code': 'Code à huit chiffres',
  'nas.inspect': 'Examiner le certificat', 'nas.inspecting': 'Examen…', 'nas.confirmCertificate': 'Comparez cette empreinte SHA-256 avec l’administration du NAS ou le journal du conteneur :',
  'nas.trustCertificate': 'J’ai comparé ce certificat par un canal fiable et je lui fais confiance', 'nas.pair': 'Faire confiance et associer', 'nas.pairing': 'Association…',
  'nas.paired': 'Appareil associé. Choisissez « Connecter et redémarrer » pour exécuter les tâches sur le NAS.',
  'nas.discovery.search': 'Rechercher les NAS du réseau', 'nas.discovery.searching': 'Recherche…', 'nas.discovery.title': 'NAS détectés',
  'nas.discovery.empty': 'Aucun NAS détecté sur ce réseau. Vous pouvez saisir son adresse HTTPS manuellement.',
  'nas.discovery.untrusted': 'La détection ne fait que suggérer une adresse et n’établit aucune confiance. Vous devez encore vérifier le certificat et associer l’appareil.',
} satisfies NasDictionary

const ptBR = {
  'nas.nav': 'NAS (Beta)', 'nas.title': 'NAS (Beta)', 'nas.experimental': 'Experimental · Beta',
  'nas.experimentalNotice': 'Este recurso ainda está em testes; o protocolo, a implantação e a compatibilidade podem mudar. Faça backup de /config e /workspaces antes do primeiro uso e não mantenha ainda a única cópia de dados importantes no NAS.',
  'nas.description': 'Execute tarefas neste computador ou conecte o Harness a um NAS. O NAS compartilha plugins, modelos, histórico e espaços de trabalho; janela, tema, notificações e downloads permanecem neste dispositivo.',
  'nas.secureStorageUnavailable': 'O armazenamento seguro do sistema não está disponível. O Desktop não salvará credenciais do NAS sem criptografia. Ative primeiro o chaveiro ou gerenciador de credenciais.',
  'nas.local.title': 'Harness local', 'nas.local.description': 'Use o diretório de dados e o ambiente deste computador. Trocar de ambiente reinicia o Desktop sem mover nem excluir dados.',
  'nas.current': 'Ambiente atual', 'nas.available': 'Disponível', 'nas.useLocal': 'Usar local', 'nas.selected': 'Conectar na próxima inicialização', 'nas.saved': 'Salvo',
  'nas.fingerprint': 'SHA-256 do certificado', 'nas.test': 'Testar conexão', 'nas.test.success': 'Conexão normal · NAS {version}',
  'nas.connect': 'Conectar e reiniciar', 'nas.remove': 'Remover', 'nas.devices': 'Gerenciar dispositivos', 'nas.devices.title': 'Dispositivos pareados',
  'nas.devices.expires': 'Expira em {date}', 'nas.devices.revoke': 'Revogar', 'nas.devices.empty': 'Nenhum dispositivo pareado.',
  'nas.add.title': 'Parear um NAS', 'nas.add.description': 'Digite a origem HTTPS exclusiva do NAS e o código de oito dígitos exibido no log do contêiner. O primeiro contato exige conferir a impressão digital do certificado.',
  'nas.address': 'Endereço HTTPS do NAS', 'nas.address.placeholder': 'Por exemplo: https://harness.example.com', 'nas.deviceName': 'Nome deste dispositivo', 'nas.code': 'Código de oito dígitos',
  'nas.inspect': 'Examinar certificado', 'nas.inspecting': 'Examinando…', 'nas.confirmCertificate': 'Compare esta impressão SHA-256 com a administração do NAS ou o log do contêiner:',
  'nas.trustCertificate': 'Comparei este certificado por um canal confiável e confio nele', 'nas.pair': 'Confiar e parear', 'nas.pairing': 'Pareando…',
  'nas.paired': 'Dispositivo pareado. Escolha “Conectar e reiniciar” para executar tarefas no NAS.',
  'nas.discovery.search': 'Buscar NAS na rede', 'nas.discovery.searching': 'Buscando…', 'nas.discovery.title': 'NAS encontrados',
  'nas.discovery.empty': 'Nenhum NAS foi encontrado nesta rede. Você ainda pode digitar o endereço HTTPS manualmente.',
  'nas.discovery.untrusted': 'A descoberta apenas sugere um endereço e não estabelece confiança. Ainda é necessário conferir o certificado e parear.',
} satisfies NasDictionary

const de = {
  'nas.nav': 'NAS (Beta)', 'nas.title': 'NAS (Beta)', 'nas.experimental': 'Experimentell · Beta',
  'nas.experimentalNotice': 'Diese Funktion wird noch getestet; Protokoll, Bereitstellung und Kompatibilität können sich ändern. Sichern Sie /config und /workspaces vor der ersten Nutzung und bewahren Sie wichtige Daten vorerst nicht ausschließlich auf dem NAS auf.',
  'nas.description': 'Aufgaben auf diesem Computer ausführen oder Harness auf einem NAS verbinden. Das NAS teilt Plugins, Modelle, Verlauf und Arbeitsbereiche; Fenster, Design, Benachrichtigungen und Downloads bleiben auf diesem Gerät.',
  'nas.secureStorageUnavailable': 'Der sichere Systemspeicher ist nicht verfügbar. Desktop speichert NAS-Zugangsdaten nicht unverschlüsselt. Aktivieren Sie zuerst Schlüsselbund oder Anmeldeinformationsverwaltung.',
  'nas.local.title': 'Lokales Harness', 'nas.local.description': 'Datenverzeichnis und Laufzeit dieses Computers verwenden. Ein Wechsel startet Desktop neu, ohne Daten zu verschieben oder zu löschen.',
  'nas.current': 'Aktuelle Laufzeit', 'nas.available': 'Verfügbar', 'nas.useLocal': 'Lokal verwenden', 'nas.selected': 'Beim nächsten Start verbinden', 'nas.saved': 'Gespeichert',
  'nas.fingerprint': 'Zertifikat-SHA-256', 'nas.test': 'Verbindung testen', 'nas.test.success': 'Verbindung erfolgreich · NAS {version}',
  'nas.connect': 'Verbinden und neu starten', 'nas.remove': 'Entfernen', 'nas.devices': 'Geräte verwalten', 'nas.devices.title': 'Gekoppelte Geräte',
  'nas.devices.expires': 'Gültig bis {date}', 'nas.devices.revoke': 'Widerrufen', 'nas.devices.empty': 'Keine gekoppelten Geräte.',
  'nas.add.title': 'NAS koppeln', 'nas.add.description': 'Geben Sie den eigenen HTTPS-Ursprung des NAS und den achtstelligen Code aus dem Containerprotokoll ein. Beim ersten Kontakt muss der Zertifikat-Fingerabdruck geprüft werden.',
  'nas.address': 'NAS-HTTPS-Adresse', 'nas.address.placeholder': 'Zum Beispiel: https://harness.example.com', 'nas.deviceName': 'Name dieses Geräts', 'nas.code': 'Achtstelliger Code',
  'nas.inspect': 'Zertifikat prüfen', 'nas.inspecting': 'Prüfung…', 'nas.confirmCertificate': 'Vergleichen Sie diesen SHA-256-Fingerabdruck mit der NAS-Verwaltung oder dem Containerprotokoll:',
  'nas.trustCertificate': 'Ich habe das Zertifikat über einen vertrauenswürdigen Kanal verglichen und vertraue ihm', 'nas.pair': 'Vertrauen und koppeln', 'nas.pairing': 'Kopplung…',
  'nas.paired': 'Gerät gekoppelt. Mit „Verbinden und neu starten“ werden Aufgaben auf dem NAS ausgeführt.',
  'nas.discovery.search': 'NAS im Netzwerk suchen', 'nas.discovery.searching': 'Suche…', 'nas.discovery.title': 'Gefundene NAS',
  'nas.discovery.empty': 'In diesem Netzwerk wurde kein NAS gefunden. Sie können die HTTPS-Adresse weiterhin manuell eingeben.',
  'nas.discovery.untrusted': 'Die Erkennung schlägt nur eine Adresse vor und schafft kein Vertrauen. Zertifikatprüfung und Kopplung bleiben erforderlich.',
} satisfies NasDictionary

const ja = {
  'nas.nav': 'NAS (Beta)', 'nas.title': 'NAS (Beta)', 'nas.experimental': '実験的 · Beta',
  'nas.experimentalNotice': 'この機能はテスト中で、プロトコル、導入手順、互換範囲が変更される場合があります。初回利用前に /config と /workspaces をバックアップし、重要データを NAS にだけ保存しないでください。',
  'nas.description': 'このコンピューターでタスクを実行するか、NAS 上の Harness に接続します。NAS モードではプラグイン、モデル、履歴、ワークスペースを共有し、ウィンドウ、テーマ、通知、ダウンロード設定はこの端末に残ります。',
  'nas.secureStorageUnavailable': 'システムの安全なストレージを使用できません。Desktop は NAS 認証情報を平文で保存しません。先にキーチェーンまたは資格情報マネージャーを有効にしてください。',
  'nas.local.title': 'ローカル Harness', 'nas.local.description': 'このコンピューターのデータディレクトリと実行環境を使用します。切り替えると Desktop は再起動しますが、データは移動・削除されません。',
  'nas.current': '現在の実行環境', 'nas.available': '切り替え可能', 'nas.useLocal': 'ローカルに切り替え', 'nas.selected': '次回起動時に接続', 'nas.saved': '保存済み',
  'nas.fingerprint': '証明書 SHA-256', 'nas.test': '接続をテスト', 'nas.test.success': '接続正常 · NAS {version}',
  'nas.connect': '接続して再起動', 'nas.remove': '削除', 'nas.devices': '端末を管理', 'nas.devices.title': 'ペアリング済み端末',
  'nas.devices.expires': '有効期限 {date}', 'nas.devices.revoke': '取り消す', 'nas.devices.empty': 'ペアリング済み端末はありません。',
  'nas.add.title': 'NAS をペアリング', 'nas.add.description': 'NAS 専用の HTTPS オリジンとコンテナログに表示される 8 桁コードを入力します。初回接続では証明書フィンガープリントの確認が必要です。',
  'nas.address': 'NAS HTTPS アドレス', 'nas.address.placeholder': '例：https://harness.example.com', 'nas.deviceName': 'この端末の名前', 'nas.code': '8 桁のペアリングコード',
  'nas.inspect': '証明書を確認', 'nas.inspecting': '確認中…', 'nas.confirmCertificate': 'この SHA-256 フィンガープリントを NAS 管理画面またはコンテナログと比較してください：',
  'nas.trustCertificate': '信頼できる経路で証明書を照合し、信頼します', 'nas.pair': '信頼してペアリング', 'nas.pairing': 'ペアリング中…',
  'nas.paired': 'ペアリングしました。「接続して再起動」を選ぶと NAS でタスクを実行します。',
  'nas.discovery.search': 'LAN の NAS を検索', 'nas.discovery.searching': '検索中…', 'nas.discovery.title': '見つかった NAS',
  'nas.discovery.empty': 'この LAN では NAS が見つかりませんでした。HTTPS アドレスは手動でも入力できます。',
  'nas.discovery.untrusted': '検出結果はアドレスの候補にすぎず、信頼を確立しません。証明書の確認とペアリングは引き続き必要です。',
} satisfies NasDictionary

const ko = {
  'nas.nav': 'NAS (Beta)', 'nas.title': 'NAS (Beta)', 'nas.experimental': '실험적 · Beta',
  'nas.experimentalNotice': '이 기능은 아직 테스트 중이며 프로토콜, 배포 방식 및 호환 범위가 변경될 수 있습니다. 처음 사용하기 전에 /config와 /workspaces를 백업하고 중요한 데이터의 유일한 사본을 NAS에만 보관하지 마세요.',
  'nas.description': '이 컴퓨터에서 작업을 실행하거나 NAS의 Harness에 연결합니다. NAS 모드는 플러그인, 모델, 기록 및 작업 공간을 공유하며 창, 테마, 알림 및 다운로드 설정은 이 기기에 유지됩니다.',
  'nas.secureStorageUnavailable': '시스템 보안 저장소를 사용할 수 없습니다. Desktop은 NAS 자격 증명을 평문으로 저장하지 않습니다. 먼저 키체인 또는 자격 증명 관리자를 활성화하세요.',
  'nas.local.title': '로컬 Harness', 'nas.local.description': '이 컴퓨터의 데이터 디렉터리와 런타임을 사용합니다. 런타임 전환 시 Desktop이 재시작되지만 데이터는 이동하거나 삭제하지 않습니다.',
  'nas.current': '현재 런타임', 'nas.available': '사용 가능', 'nas.useLocal': '로컬로 전환', 'nas.selected': '다음 시작 시 연결', 'nas.saved': '저장됨',
  'nas.fingerprint': '인증서 SHA-256', 'nas.test': '연결 테스트', 'nas.test.success': '연결 정상 · NAS {version}',
  'nas.connect': '연결 후 재시작', 'nas.remove': '제거', 'nas.devices': '기기 관리', 'nas.devices.title': '페어링된 기기',
  'nas.devices.expires': '{date}까지 유효', 'nas.devices.revoke': '취소', 'nas.devices.empty': '페어링된 기기가 없습니다.',
  'nas.add.title': 'NAS 페어링', 'nas.add.description': 'NAS 전용 HTTPS 원본과 컨테이너 로그의 8자리 코드를 입력하세요. 최초 연결에서는 인증서 지문을 확인해야 합니다.',
  'nas.address': 'NAS HTTPS 주소', 'nas.address.placeholder': '예: https://harness.example.com', 'nas.deviceName': '이 기기 이름', 'nas.code': '8자리 페어링 코드',
  'nas.inspect': '인증서 확인', 'nas.inspecting': '확인 중…', 'nas.confirmCertificate': '이 SHA-256 지문을 NAS 관리 화면 또는 컨테이너 로그와 비교하세요:',
  'nas.trustCertificate': '신뢰할 수 있는 경로로 인증서를 비교했으며 신뢰합니다', 'nas.pair': '신뢰하고 페어링', 'nas.pairing': '페어링 중…',
  'nas.paired': '페어링되었습니다. “연결 후 재시작”을 선택하면 NAS에서 작업을 실행합니다.',
  'nas.discovery.search': 'LAN NAS 검색', 'nas.discovery.searching': '검색 중…', 'nas.discovery.title': '검색된 NAS',
  'nas.discovery.empty': '이 LAN에서 NAS를 찾지 못했습니다. HTTPS 주소를 직접 입력할 수도 있습니다.',
  'nas.discovery.untrusted': '검색 결과는 주소만 제안하며 신뢰를 설정하지 않습니다. 인증서 확인과 페어링이 계속 필요합니다.',
} satisfies NasDictionary

/** Non-core locale dictionaries for the NAS Runtime settings page. */
export const NAS_TRANSLATIONS = { es, fr, 'pt-BR': ptBR, de, ja, ko } as const
