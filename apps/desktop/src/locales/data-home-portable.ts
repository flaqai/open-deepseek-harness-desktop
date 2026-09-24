/** Copy for the plugin migration step in the data-home chooser. */
import { desktopDictionary, type DesktopLocaleId } from '../desktop-locale.ts'

const zh = {
  title: '选择插件迁移方式', summary: '配置和插件清单都会复制；插件本体可在线重装，或从单独制作的离线包恢复。',
  online: '联网迁移插件', onlineDetail: '进入桌面版后，从原始来源重新下载并安装需要的插件。',
  offline: '离线迁移插件', offlineDetail: '选取在源电脑制作的离线迁移包；目标电脑无需联网下载插件。',
  choose: '选择离线迁移包 .tgz', checking: '正在验证离线包…',
  selected: '包目标系统', currentHost: '本机系统（导出时填写此值）', required: '请先选择有效的离线迁移包。', invalid: '离线迁移包损坏、无法读取，或目标系统/版本与本机不符，请重新选择。',
}
type Copy = { readonly [K in keyof typeof zh]: string }
const en: Copy = {
  title: 'Choose plugin migration', summary: 'Configuration and the plugin list are copied. Reinstall plugins online or restore them from a separately prepared offline transfer.',
  online: 'Migrate plugins online', onlineDetail: 'After entering Desktop, download and install needed plugins from their original sources.',
  offline: 'Migrate plugins offline', offlineDetail: 'Choose a transfer prepared on the source computer. The destination does not need to download plugins.',
  choose: 'Choose offline transfer .tgz', checking: 'Verifying offline transfer…',
  selected: 'Transfer target OS', currentHost: 'This computer (enter this value when exporting)', required: 'Choose a valid offline transfer first.', invalid: 'The transfer is damaged, unreadable, or targets a different OS/version. Choose it again.',
}
const ja: Copy = {
  title: 'プラグインの移行方法', summary: '設定とプラグイン一覧をコピーします。プラグイン本体はオンラインで再インストールするか、別途作成したオフラインパッケージから復元します。',
  online: 'オンラインで移行', onlineDetail: 'Desktop 起動後、元の配布元から必要なプラグインを再取得します。',
  offline: 'オフラインで移行', offlineDetail: '移行元で作成したパッケージを選びます。移行先でのダウンロードは不要です。',
  choose: 'オフライン .tgz を選択', checking: 'パッケージを検証中…',
  selected: '対象 OS', currentHost: 'このコンピューター（エクスポート時に入力）', required: '有効なパッケージを選択してください。', invalid: 'パッケージが破損・読み取り不可、または対象 OS／バージョンが異なります。選び直してください。',
}
const ko: Copy = {
  title: '플러그인 이전 방식', summary: '설정과 플러그인 목록을 복사합니다. 플러그인은 온라인으로 다시 설치하거나 별도로 만든 오프라인 패키지에서 복원할 수 있습니다.',
  online: '온라인 이전', onlineDetail: 'Desktop 실행 후 원래 출처에서 필요한 플러그인을 다시 내려받습니다.',
  offline: '오프라인 이전', offlineDetail: '원본 컴퓨터에서 만든 패키지를 선택합니다. 대상 컴퓨터에서 다운로드하지 않습니다.',
  choose: '오프라인 .tgz 선택', checking: '패키지 검증 중…',
  selected: '대상 OS', currentHost: '이 컴퓨터(내보낼 때 입력)', required: '유효한 오프라인 패키지를 선택하세요.', invalid: '패키지가 손상되었거나 읽을 수 없거나 대상 OS/버전이 다릅니다. 다시 선택하세요.',
}
const es: Copy = {
  title: 'Elegir migración de complementos', summary: 'Se copian la configuración y la lista. Reinstala los complementos en línea o restáuralos desde un paquete sin conexión.',
  online: 'Migrar en línea', onlineDetail: 'Después de abrir Desktop, descarga los complementos desde sus fuentes originales.',
  offline: 'Migrar sin conexión', offlineDetail: 'Elige un paquete creado en el equipo de origen; el destino no necesita descargar complementos.',
  choose: 'Elegir paquete .tgz', checking: 'Verificando el paquete…',
  selected: 'Sistema de destino', currentHost: 'Este equipo (indica este valor al exportar)', required: 'Elige un paquete válido.', invalid: 'El paquete está dañado, no se puede leer o corresponde a otro sistema o versión. Vuelve a elegirlo.',
}
const fr: Copy = {
  title: 'Choisir la migration des extensions', summary: 'La configuration et la liste sont copiées. Réinstallez les extensions en ligne ou restaurez-les depuis un paquet hors ligne.',
  online: 'Migrer en ligne', onlineDetail: 'Après l’ouverture de Desktop, téléchargez les extensions depuis leurs sources d’origine.',
  offline: 'Migrer hors ligne', offlineDetail: 'Choisissez un paquet créé sur l’ordinateur source ; aucune récupération n’est nécessaire sur la cible.',
  choose: 'Choisir le paquet .tgz', checking: 'Vérification du paquet…',
  selected: 'OS cible', currentHost: 'Cet ordinateur (saisir cette valeur lors de l’export)', required: 'Choisissez un paquet valide.', invalid: 'Le paquet est endommagé, illisible ou destiné à une autre version du système. Choisissez-le à nouveau.',
}
const de: Copy = {
  title: 'Plugin-Migration wählen', summary: 'Konfiguration und Plugin-Liste werden kopiert. Plugins können online neu installiert oder aus einem Offline-Paket wiederhergestellt werden.',
  online: 'Online migrieren', onlineDetail: 'Nach dem Start von Desktop werden benötigte Plugins aus ihren Originalquellen geladen.',
  offline: 'Offline migrieren', offlineDetail: 'Ein auf dem Quellrechner erstelltes Paket wählen; der Zielrechner muss Plugins nicht herunterladen.',
  choose: 'Offline-Paket .tgz wählen', checking: 'Paket wird geprüft…',
  selected: 'Ziel-Betriebssystem', currentHost: 'Dieser Computer (Wert beim Export eingeben)', required: 'Bitte ein gültiges Paket wählen.', invalid: 'Das Paket ist beschädigt, nicht lesbar oder für ein anderes System bzw. eine andere Version bestimmt.',
}
const ptBR: Copy = {
  title: 'Escolher migração de plugins', summary: 'A configuração e a lista são copiadas. Reinstale plugins online ou restaure-os de um pacote offline.',
  online: 'Migrar online', onlineDetail: 'Após abrir o Desktop, baixe os plugins de suas fontes originais.',
  offline: 'Migrar offline', offlineDetail: 'Escolha um pacote criado no computador de origem; o destino não precisa baixar plugins.',
  choose: 'Escolher pacote .tgz', checking: 'Verificando pacote…',
  selected: 'Sistema de destino', currentHost: 'Este computador (informe este valor ao exportar)', required: 'Escolha um pacote válido.', invalid: 'O pacote está danificado, ilegível ou é para outro sistema/versão. Escolha novamente.',
}
const ru: Copy = {
  title: 'Способ переноса плагинов', summary: 'Конфигурация и список копируются. Плагины можно переустановить через сеть или восстановить из офлайн-пакета.',
  online: 'Перенести через сеть', onlineDetail: 'После запуска Desktop нужные плагины загрузятся из исходных источников.',
  offline: 'Перенести офлайн', offlineDetail: 'Выберите пакет, созданный на исходном компьютере; целевому не нужна загрузка плагинов.',
  choose: 'Выбрать пакет .tgz', checking: 'Проверка пакета…',
  selected: 'Целевая ОС', currentHost: 'Этот компьютер (укажите значение при экспорте)', required: 'Выберите корректный пакет.', invalid: 'Пакет повреждён, недоступен или предназначен для другой ОС/версии. Выберите снова.',
}

export function portableCopyFor(locale: DesktopLocaleId): Copy {
  return desktopDictionary(locale, { zh, en, ja, ko, es, fr, de, 'pt-BR': ptBR, ru })
}
