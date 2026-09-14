/** Application-menu dictionaries for community locales beyond Chinese, English, and Russian. */
import type { ApplicationMenuCopy } from '../application-menu.ts'

const ja: ApplicationMenuCopy = {
  app: 'Open DeepSeek Harness Desktop', file: 'ファイル', edit: '編集', view: '表示', tools: 'ツール', window: 'ウインドウ', help: 'ヘルプ', more: 'その他',
  about: 'Open DeepSeek Harness Desktop について', settings: '設定…', updates: 'アップデートを確認…', 'new-session': '新しい会話',
  'open-config': '設定ファイルを開く', 'open-web': 'ブラウザで開く', close: 'ウインドウを閉じる', quit: '完全に終了',
  undo: '取り消す', redo: 'やり直す', cut: '切り取り', copy: 'コピー', paste: 'ペースト', 'select-all': 'すべてを選択',
  'zoom-in': '拡大', 'zoom-out': '縮小', 'zoom-reset': '実際のサイズ', fullscreen: 'フルスクリーンにする', 'leave-fullscreen': 'フルスクリーンを解除',
  market: 'プラグインマーケット', 'plugin-restore': 'プラグインの復元', diagnostics: '診断センター', snapshots: 'プラグインスナップショット',
  'external-tools': '外部ツール', phone: 'スマートフォンからのアクセス', im: 'IM ボット', 'data-home': '設定ディレクトリを切り替える…', restart: 'クイック再起動',
  show: 'メインウインドウを表示', minimize: 'しまう', maximize: '拡大', restore: '元のサイズに戻す', docs: 'ドキュメント',
  repository: 'プロジェクトリポジトリ', feedback: '問題を報告', logs: 'ログディレクトリを開く', devtools: '開発者ツール', services: 'サービス',
  hide: 'Open DeepSeek Harness Desktop を隠す', 'hide-others': 'ほかを隠す', unhide: 'すべてを表示', emoji: '絵文字と記号', error: '操作を完了できません',
  unavailable: 'クライアントの起動中、切断中、または復旧中はこの操作を利用できません。',
  busy: 'プラグイン操作または復旧を実行中です。完了してから再起動または終了してください。',
  tray: 'システムトレイを利用できません。キャンセルしてウインドウを残すか、完全に終了してください。', cancel: 'キャンセル',
  shutdownFailed: 'バックグラウンドプロセスの終了処理が完了していないため、終了と再起動を停止しました。ログを確認してから終了を再試行してください。',
  community: 'FLAQ AI が独立して保守するコミュニティ版であり、DeepSeek の公式製品ではありません。',
}

const ko: ApplicationMenuCopy = {
  app: 'Open DeepSeek Harness Desktop', file: '파일', edit: '편집', view: '보기', tools: '도구', window: '창', help: '도움말', more: '더 보기',
  about: 'Open DeepSeek Harness Desktop 정보', settings: '설정…', updates: '업데이트 확인…', 'new-session': '새 대화',
  'open-config': '구성 파일 열기', 'open-web': '브라우저에서 열기', close: '창 닫기', quit: '완전히 종료', undo: '실행 취소', redo: '다시 실행',
  cut: '잘라내기', copy: '복사', paste: '붙여넣기', 'select-all': '모두 선택', 'zoom-in': '확대', 'zoom-out': '축소', 'zoom-reset': '실제 크기',
  fullscreen: '전체 화면 시작', 'leave-fullscreen': '전체 화면 종료', market: '플러그인 마켓', 'plugin-restore': '플러그인 복구', diagnostics: '진단 센터',
  snapshots: '플러그인 스냅샷', 'external-tools': '외부 도구', phone: '휴대전화 접속', im: 'IM 봇', 'data-home': '구성 디렉터리 전환…', restart: '빠른 재시작',
  show: '기본 창 표시', minimize: '최소화', maximize: '최대화', restore: '복원', docs: '문서', repository: '프로젝트 저장소', feedback: '문제 신고',
  logs: '로그 디렉터리 열기', devtools: '개발자 도구', services: '서비스', hide: 'Open DeepSeek Harness Desktop 숨기기', 'hide-others': '다른 항목 숨기기',
  unhide: '모두 표시', emoji: '이모티콘 및 기호', error: '작업을 완료할 수 없음',
  unavailable: '클라이언트가 시작, 연결 해제 또는 복구 중일 때는 이 작업을 사용할 수 없습니다.',
  busy: '플러그인 작업 또는 복구가 진행 중입니다. 완료된 후 다시 시작하거나 종료하세요.',
  tray: '시스템 트레이를 사용할 수 없습니다. 취소하여 창을 유지하거나 완전히 종료하세요.', cancel: '취소',
  shutdownFailed: '백그라운드 프로세스 정리가 완료되지 않아 종료와 재시작이 차단되었습니다. 로그를 확인한 후 종료를 다시 시도하세요.',
  community: 'FLAQ AI가 독립적으로 유지 관리하는 커뮤니티 배포판이며 DeepSeek 공식 제품이 아닙니다.',
}

const es: ApplicationMenuCopy = {
  app: 'Open DeepSeek Harness Desktop', file: 'Archivo', edit: 'Edición', view: 'Ver', tools: 'Herramientas', window: 'Ventana', help: 'Ayuda', more: 'Más',
  about: 'Acerca de Open DeepSeek Harness Desktop', settings: 'Ajustes…', updates: 'Buscar actualizaciones…', 'new-session': 'Nueva conversación',
  'open-config': 'Abrir archivo de configuración', 'open-web': 'Abrir en el navegador', close: 'Cerrar ventana', quit: 'Salir completamente',
  undo: 'Deshacer', redo: 'Rehacer', cut: 'Cortar', copy: 'Copiar', paste: 'Pegar', 'select-all': 'Seleccionar todo',
  'zoom-in': 'Ampliar', 'zoom-out': 'Reducir', 'zoom-reset': 'Tamaño real', fullscreen: 'Entrar en pantalla completa', 'leave-fullscreen': 'Salir de pantalla completa',
  market: 'Mercado de plugins', 'plugin-restore': 'Recuperación de plugins', diagnostics: 'Centro de diagnóstico', snapshots: 'Instantáneas de plugins',
  'external-tools': 'Herramientas externas', phone: 'Acceso móvil', im: 'Bots de IM', 'data-home': 'Cambiar directorio de configuración…', restart: 'Reinicio rápido',
  show: 'Mostrar ventana principal', minimize: 'Minimizar', maximize: 'Maximizar', restore: 'Restaurar', docs: 'Documentación', repository: 'Repositorio del proyecto',
  feedback: 'Informar de un problema', logs: 'Abrir directorio de registros', devtools: 'Herramientas de desarrollo', services: 'Servicios',
  hide: 'Ocultar Open DeepSeek Harness Desktop', 'hide-others': 'Ocultar las demás', unhide: 'Mostrar todo', emoji: 'Emojis y símbolos', error: 'No se pudo completar la acción',
  unavailable: 'Esta acción no está disponible mientras el cliente se inicia, está desconectado o se recupera.',
  busy: 'Hay una operación de plugins o una recuperación en curso. Espera a que termine antes de reiniciar o salir.',
  tray: 'La bandeja del sistema no está disponible. Cancela para mantener la ventana abierta o sal completamente.', cancel: 'Cancelar',
  shutdownFailed: 'La limpieza de procesos en segundo plano no terminó. Se bloquearon la salida y el reinicio. Revisa los registros y vuelve a intentar salir.',
  community: 'Distribución comunitaria independiente mantenida por FLAQ AI; no es un producto oficial de DeepSeek.',
}

const fr: ApplicationMenuCopy = {
  app: 'Open DeepSeek Harness Desktop', file: 'Fichier', edit: 'Édition', view: 'Présentation', tools: 'Outils', window: 'Fenêtre', help: 'Aide', more: 'Plus',
  about: 'À propos d’Open DeepSeek Harness Desktop', settings: 'Réglages…', updates: 'Rechercher les mises à jour…', 'new-session': 'Nouvelle conversation',
  'open-config': 'Ouvrir le fichier de configuration', 'open-web': 'Ouvrir dans le navigateur', close: 'Fermer la fenêtre', quit: 'Quitter complètement',
  undo: 'Annuler', redo: 'Rétablir', cut: 'Couper', copy: 'Copier', paste: 'Coller', 'select-all': 'Tout sélectionner',
  'zoom-in': 'Zoom avant', 'zoom-out': 'Zoom arrière', 'zoom-reset': 'Taille réelle', fullscreen: 'Activer le plein écran', 'leave-fullscreen': 'Quitter le plein écran',
  market: 'Marché des plugins', 'plugin-restore': 'Récupération des plugins', diagnostics: 'Centre de diagnostic', snapshots: 'Instantanés des plugins',
  'external-tools': 'Outils externes', phone: 'Accès mobile', im: 'Robots IM', 'data-home': 'Changer de dossier de configuration…', restart: 'Redémarrage rapide',
  show: 'Afficher la fenêtre principale', minimize: 'Réduire', maximize: 'Agrandir', restore: 'Restaurer', docs: 'Documentation', repository: 'Dépôt du projet',
  feedback: 'Signaler un problème', logs: 'Ouvrir le dossier des journaux', devtools: 'Outils de développement', services: 'Services',
  hide: 'Masquer Open DeepSeek Harness Desktop', 'hide-others': 'Masquer les autres', unhide: 'Tout afficher', emoji: 'Emoji et symboles', error: 'Impossible d’effectuer l’action',
  unavailable: 'Cette action est indisponible pendant le démarrage, la déconnexion ou la récupération du client.',
  busy: 'Une opération de plugin ou une récupération est en cours. Attendez sa fin avant de redémarrer ou de quitter.',
  tray: 'La zone de notification est indisponible. Annulez pour garder la fenêtre ouverte ou quittez complètement.', cancel: 'Annuler',
  shutdownFailed: 'Le nettoyage des processus en arrière-plan n’est pas terminé. La fermeture et le redémarrage ont été bloqués. Consultez les journaux, puis réessayez de quitter.',
  community: 'Distribution communautaire indépendante maintenue par FLAQ AI, et non un produit officiel DeepSeek.',
}

const de: ApplicationMenuCopy = {
  app: 'Open DeepSeek Harness Desktop', file: 'Datei', edit: 'Bearbeiten', view: 'Ansicht', tools: 'Werkzeuge', window: 'Fenster', help: 'Hilfe', more: 'Mehr',
  about: 'Über Open DeepSeek Harness Desktop', settings: 'Einstellungen…', updates: 'Nach Updates suchen…', 'new-session': 'Neue Unterhaltung',
  'open-config': 'Konfigurationsdatei öffnen', 'open-web': 'Im Browser öffnen', close: 'Fenster schließen', quit: 'Vollständig beenden',
  undo: 'Rückgängig', redo: 'Wiederholen', cut: 'Ausschneiden', copy: 'Kopieren', paste: 'Einfügen', 'select-all': 'Alles auswählen',
  'zoom-in': 'Vergrößern', 'zoom-out': 'Verkleinern', 'zoom-reset': 'Originalgröße', fullscreen: 'Vollbild aktivieren', 'leave-fullscreen': 'Vollbild beenden',
  market: 'Plugin-Markt', 'plugin-restore': 'Plugin-Wiederherstellung', diagnostics: 'Diagnosezentrum', snapshots: 'Plugin-Snapshots',
  'external-tools': 'Externe Werkzeuge', phone: 'Mobilzugriff', im: 'IM-Bots', 'data-home': 'Konfigurationsverzeichnis wechseln…', restart: 'Schnell neu starten',
  show: 'Hauptfenster anzeigen', minimize: 'Minimieren', maximize: 'Maximieren', restore: 'Wiederherstellen', docs: 'Dokumentation', repository: 'Projekt-Repository',
  feedback: 'Problem melden', logs: 'Protokollverzeichnis öffnen', devtools: 'Entwicklerwerkzeuge', services: 'Dienste',
  hide: 'Open DeepSeek Harness Desktop ausblenden', 'hide-others': 'Andere ausblenden', unhide: 'Alle einblenden', emoji: 'Emoji und Symbole', error: 'Aktion konnte nicht abgeschlossen werden',
  unavailable: 'Diese Aktion ist während Start, Trennung oder Wiederherstellung des Clients nicht verfügbar.',
  busy: 'Ein Plugin-Vorgang oder eine Wiederherstellung läuft. Warten Sie vor Neustart oder Beenden auf den Abschluss.',
  tray: 'Der Infobereich ist nicht verfügbar. Brechen Sie ab, um das Fenster offen zu lassen, oder beenden Sie vollständig.', cancel: 'Abbrechen',
  shutdownFailed: 'Die Bereinigung der Hintergrundprozesse wurde nicht abgeschlossen. Beenden und Neustart wurden blockiert. Prüfen Sie die Protokolle und versuchen Sie das Beenden erneut.',
  community: 'Unabhängige, von FLAQ AI gepflegte Community-Distribution; kein offizielles DeepSeek-Produkt.',
}

const ptBR: ApplicationMenuCopy = {
  app: 'Open DeepSeek Harness Desktop', file: 'Arquivo', edit: 'Editar', view: 'Visualizar', tools: 'Ferramentas', window: 'Janela', help: 'Ajuda', more: 'Mais',
  about: 'Sobre o Open DeepSeek Harness Desktop', settings: 'Configurações…', updates: 'Verificar atualizações…', 'new-session': 'Nova conversa',
  'open-config': 'Abrir arquivo de configuração', 'open-web': 'Abrir no navegador', close: 'Fechar janela', quit: 'Sair completamente',
  undo: 'Desfazer', redo: 'Refazer', cut: 'Recortar', copy: 'Copiar', paste: 'Colar', 'select-all': 'Selecionar tudo',
  'zoom-in': 'Ampliar', 'zoom-out': 'Reduzir', 'zoom-reset': 'Tamanho real', fullscreen: 'Entrar em tela cheia', 'leave-fullscreen': 'Sair da tela cheia',
  market: 'Mercado de plugins', 'plugin-restore': 'Recuperação de plugins', diagnostics: 'Central de diagnóstico', snapshots: 'Snapshots de plugins',
  'external-tools': 'Ferramentas externas', phone: 'Acesso pelo celular', im: 'Bots de IM', 'data-home': 'Trocar diretório de configuração…', restart: 'Reinício rápido',
  show: 'Mostrar janela principal', minimize: 'Minimizar', maximize: 'Maximizar', restore: 'Restaurar', docs: 'Documentação', repository: 'Repositório do projeto',
  feedback: 'Relatar um problema', logs: 'Abrir diretório de logs', devtools: 'Ferramentas do desenvolvedor', services: 'Serviços',
  hide: 'Ocultar Open DeepSeek Harness Desktop', 'hide-others': 'Ocultar outros', unhide: 'Mostrar tudo', emoji: 'Emoji e símbolos', error: 'Não foi possível concluir a ação',
  unavailable: 'Esta ação fica indisponível enquanto o cliente inicia, está desconectado ou se recupera.',
  busy: 'Há uma operação de plugin ou recuperação em andamento. Aguarde antes de reiniciar ou sair.',
  tray: 'A bandeja do sistema está indisponível. Cancele para manter a janela aberta ou saia completamente.', cancel: 'Cancelar',
  shutdownFailed: 'A limpeza dos processos em segundo plano não foi concluída. A saída e a reinicialização foram bloqueadas. Verifique os logs e tente sair novamente.',
  community: 'Distribuição comunitária independente mantida pela FLAQ AI; não é um produto oficial da DeepSeek.',
}

/** Additional dictionaries kept separate so the command registry stays readable. */
export const additionalApplicationMenuDictionaries = { ja, ko, es, fr, de, 'pt-BR': ptBR } as const
