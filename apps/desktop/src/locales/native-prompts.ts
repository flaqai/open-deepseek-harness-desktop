import { desktopDictionary, formatDesktopCopy } from '../desktop-locale.ts'

const en = {
  buildDetail: 'pnpm blocked the build script for {package}. The plugin is already safely isolated, so you can continue without allowing it. Only allow a source you trust.',
  allowRestore: 'Allow and restore plugin',
  keepIsolated: 'Keep isolated',
  quit: 'Quit',
  recoveryDetail: 'The approval could not be completed safely or the plugin has another issue. It remains isolated and can be retried later in Diagnostics.\n\n{detail}',
  continue: 'Continue',
  permissionDetail: 'Only the current local Harness page can use this capability after you approve it. Denying it will not affect other features.',
  deny: 'Deny',
  allow: 'Allow',
  localDetail: 'Imported declaration: {spec}\nLocal version: {version}\nThe local package will install into the independent Desktop environment.',
  unknown: 'unknown',
  cancel: 'Cancel',
  install: 'Install anyway',
}

const zh = {
  buildDetail: 'pnpm 已阻止 {package} 的构建脚本。该插件已被安全隔离，因此即使不允许也可以继续进入应用。仅在你信任插件来源时允许。',
  allowRestore: '允许构建并恢复插件',
  keepIsolated: '不允许，保持隔离',
  quit: '退出应用',
  recoveryDetail: '构建许可未能安全完成或插件仍有其他问题。插件会继续保持隔离，可稍后在“诊断”中重试。\n\n{detail}',
  continue: '继续',
  permissionDetail: '仅在你确认后，当前本机 Harness 页面才能使用此能力。拒绝不会影响其他功能。',
  deny: '拒绝',
  allow: '允许',
  localDetail: '原声明：{spec}\n本地版本：{version}\n本地包将安装到桌面版独立环境。',
  unknown: '未知',
  cancel: '取消',
  install: '继续安装',
}

const ja = {
  buildDetail: 'pnpm が {package} のビルドスクリプトをブロックしました。プラグインは安全に隔離されており、許可せずにアプリを利用できます。信頼できる取得元のみ許可してください。',
  allowRestore: '許可してプラグインを復元',
  keepIsolated: '隔離を維持',
  quit: '終了',
  recoveryDetail: '承認を安全に完了できないか、プラグインに別の問題があります。隔離は維持され、後で診断から再試行できます。\n\n{detail}',
  continue: '続行',
  permissionDetail: '承認後は、現在のローカル Harness ページのみがこの機能を使用できます。拒否しても他の機能には影響しません。',
  deny: '拒否',
  allow: '許可',
  localDetail: '元の宣言：{spec}\nローカルバージョン：{version}\nローカルパッケージを独立したデスクトップ環境にインストールします。',
  unknown: '不明',
  cancel: 'キャンセル',
  install: 'インストールを続行',
}

const es = {
  buildDetail: 'pnpm bloqueó el script de compilación de {package}. El complemento está aislado de forma segura; puedes continuar sin autorizarlo. Autoriza solo fuentes de confianza.',
  allowRestore: 'Autorizar y restaurar complemento',
  keepIsolated: 'Mantener aislado',
  quit: 'Salir',
  recoveryDetail: 'No se pudo completar la autorización de forma segura o el complemento tiene otro problema. Permanece aislado y puedes reintentarlo en Diagnóstico.\n\n{detail}',
  continue: 'Continuar',
  permissionDetail: 'Solo la página local actual de Harness podrá usar esta función tras tu aprobación. Denegarla no afecta a otras funciones.',
  deny: 'Denegar',
  allow: 'Permitir',
  localDetail: 'Declaración importada: {spec}\nVersión local: {version}\nEl paquete local se instalará en el entorno de escritorio independiente.',
  unknown: 'desconocida',
  cancel: 'Cancelar',
  install: 'Instalar de todos modos',
}

const fr = {
  buildDetail: 'pnpm a bloqué le script de compilation de {package}. Le plugin est déjà isolé en sécurité ; vous pouvez continuer sans l’autoriser. N’autorisez que les sources de confiance.',
  allowRestore: 'Autoriser et restaurer le plugin',
  keepIsolated: 'Maintenir isolé',
  quit: 'Quitter',
  recoveryDetail: 'L’autorisation n’a pas pu être finalisée en sécurité ou le plugin présente un autre problème. Il reste isolé ; réessayez plus tard dans Diagnostics.\n\n{detail}',
  continue: 'Continuer',
  permissionDetail: 'Seule la page locale actuelle de Harness pourra utiliser cette fonctionnalité après votre accord. Le refus n’affecte pas les autres fonctionnalités.',
  deny: 'Refuser',
  allow: 'Autoriser',
  localDetail: 'Déclaration importée : {spec}\nVersion locale : {version}\nLe paquet local sera installé dans l’environnement de bureau indépendant.',
  unknown: 'inconnue',
  cancel: 'Annuler',
  install: 'Installer quand même',
}

const de = {
  buildDetail: 'pnpm hat das Build-Skript für {package} blockiert. Das Plugin ist bereits sicher isoliert; Sie können ohne Freigabe fortfahren. Erlauben Sie nur vertrauenswürdige Quellen.',
  allowRestore: 'Erlauben und Plugin wiederherstellen',
  keepIsolated: 'Isoliert lassen',
  quit: 'Beenden',
  recoveryDetail: 'Die Freigabe konnte nicht sicher abgeschlossen werden oder das Plugin hat ein anderes Problem. Es bleibt isoliert und kann später unter Diagnose erneut geprüft werden.\n\n{detail}',
  continue: 'Weiter',
  permissionDetail: 'Nur die aktuelle lokale Harness-Seite kann diese Funktion nach Ihrer Zustimmung nutzen. Eine Ablehnung beeinträchtigt keine anderen Funktionen.',
  deny: 'Ablehnen',
  allow: 'Erlauben',
  localDetail: 'Importierte Deklaration: {spec}\nLokale Version: {version}\nDas lokale Paket wird in der unabhängigen Desktop-Umgebung installiert.',
  unknown: 'unbekannt',
  cancel: 'Abbrechen',
  install: 'Trotzdem installieren',
}

const ru = {
  buildDetail: 'pnpm заблокировал скрипт сборки {package}. Плагин уже безопасно изолирован, поэтому можно продолжить без разрешения. Разрешайте только доверенные источники.',
  allowRestore: 'Разрешить и восстановить плагин',
  keepIsolated: 'Оставить изолированным',
  quit: 'Выйти',
  recoveryDetail: 'Не удалось безопасно завершить разрешение или у плагина другая проблема. Он остаётся изолированным; повторите попытку позже в диагностике.\n\n{detail}',
  continue: 'Продолжить',
  permissionDetail: 'Только текущая локальная страница Harness сможет использовать эту возможность после вашего согласия. Отказ не повлияет на другие функции.',
  deny: 'Запретить',
  allow: 'Разрешить',
  localDetail: 'Импортированная декларация: {spec}\nЛокальная версия: {version}\nЛокальный пакет будет установлен в независимую среду настольного приложения.',
  unknown: 'неизвестна',
  cancel: 'Отмена',
  install: 'Всё равно установить',
}

const ptBR = {
  buildDetail: 'O pnpm bloqueou o script de compilação de {package}. O plugin já está isolado com segurança; você pode continuar sem autorizar. Autorize apenas fontes confiáveis.',
  allowRestore: 'Autorizar e restaurar plugin',
  keepIsolated: 'Manter isolado',
  quit: 'Sair',
  recoveryDetail: 'Não foi possível concluir a autorização com segurança ou o plugin tem outro problema. Ele permanece isolado; tente novamente mais tarde em Diagnóstico.\n\n{detail}',
  continue: 'Continuar',
  permissionDetail: 'Somente a página local atual do Harness poderá usar este recurso após sua aprovação. Negar não afeta outros recursos.',
  deny: 'Negar',
  allow: 'Permitir',
  localDetail: 'Declaração importada: {spec}\nVersão local: {version}\nO pacote local será instalado no ambiente independente do desktop.',
  unknown: 'desconhecida',
  cancel: 'Cancelar',
  install: 'Instalar mesmo assim',
}

const ko = {
  buildDetail: 'pnpm이 {package}의 빌드 스크립트를 차단했습니다. 플러그인은 이미 안전하게 격리되어 있어 허용하지 않고 계속할 수 있습니다. 신뢰하는 출처만 허용하세요.',
  allowRestore: '허용하고 플러그인 복원',
  keepIsolated: '격리 유지',
  quit: '종료',
  recoveryDetail: '승인을 안전하게 완료하지 못했거나 플러그인에 다른 문제가 있습니다. 격리 상태가 유지되며 나중에 진단에서 다시 시도할 수 있습니다.\n\n{detail}',
  continue: '계속',
  permissionDetail: '승인 후 현재 로컬 Harness 페이지만 이 기능을 사용할 수 있습니다. 거부해도 다른 기능에는 영향을 주지 않습니다.',
  deny: '거부',
  allow: '허용',
  localDetail: '가져온 선언: {spec}\n로컬 버전: {version}\n로컬 패키지는 독립된 데스크톱 환경에 설치됩니다.',
  unknown: '알 수 없음',
  cancel: '취소',
  install: '계속 설치',
}

/** Localized native consent and recovery text, selected by the desktop locale. */
export function nativePromptMessages(locale: string): typeof en {
  return desktopDictionary(locale, { en, zh, ja, es, fr, de, ru, 'pt-BR': ptBR, ko })
}

/** Fill a native prompt template without interpreting user-supplied values. */
export function nativePromptText(template: string, values: Readonly<Record<string, unknown>>): string {
  return formatDesktopCopy(template, values)
}
