/** Current rc.1 right-sidebar and document-preview copy for every community locale. */
import { COMMUNITY_TRANSLATIONS } from './index.ts'

type Dictionary = Record<string, string>
interface SurfaceCopy {
  sidebarRight: Dictionary
  sidebarFiles: Dictionary
  sidebarDocumentPreview: Dictionary
  documentMarkdown: Dictionary
  sidebarPdf: Dictionary
  documentHtml: Dictionary
  sidebarCodePreview: Dictionary
  sidebarImage: Dictionary
}
interface SurfaceExtra {
  right: readonly [string, string, string, string, string, string, string]
  commands: readonly [string, string, string, string, string, string, string, string, string, string, string, string, string]
  files: readonly [string, string, string, string]
  previewRefresh: readonly [string, string, string]
  zoom: readonly [string, string, string, string, string, string]
  preview: readonly [string, string, string, string, string, string, string, string]
  markdown: readonly [string, string, string, string]
  pdf: readonly [string, string, string, string, string, string, string, string, string]
  html: readonly [string, string, string, string]
  code: readonly [string, string, string]
  image: readonly [string, string, string, string, string]
}

function legacy(locale: keyof typeof COMMUNITY_TRANSLATIONS, namespace: string): Dictionary {
  return (COMMUNITY_TRANSLATIONS[locale] as Record<string, Dictionary>)[namespace] ?? {}
}

function surface(locale: keyof typeof COMMUNITY_TRANSLATIONS, extra: SurfaceExtra): SurfaceCopy {
  const right = legacy(locale, 'sidebarRight')
  const files = legacy(locale, 'sidebarFiles')
  const preview = legacy(locale, 'sidebarTextpreview')
  const zoom = {
    zoomControls: extra.zoom[0], zoomMenu: extra.zoom[1], zoomOut: extra.zoom[2],
    zoomIn: extra.zoom[3], zoomFitWidth: extra.zoom[4], zoomValue: extra.zoom[5],
  }
  return {
    sidebarRight: {
      'chrome.expand': right['chrome.expand'] ?? '', 'chrome.expandAria': extra.right[0],
      'chrome.collapse': right['chrome.collapse'] ?? '', 'chrome.collapseAria': extra.right[1],
      'chrome.toFullscreen': right['chrome.toFullscreen'] ?? '', 'chrome.exitFullscreen': right['chrome.exitFullscreen'] ?? '',
      'dock.emptyPane': right['dock.emptyPane'] ?? '', 'dock.splitPane': right['dock.splitPane'] ?? '',
      'dock.splitPaneDisabled': right['dock.splitPaneDisabled'] ?? '', 'dock.splitPaneNarrow': right['dock.splitPaneNarrow'] ?? '',
      'dock.closeTab': right['dock.closeTab'] ?? '', 'dock.addTab': right['dock.addTab'] ?? '',
      'dock.dockFloat': right['dock.dockFloat'] ?? '', 'dock.closeFloat': right['dock.closeFloat'] ?? '',
      'dock.drop.center': extra.right[2], 'dock.drop.left': extra.right[3], 'dock.drop.right': extra.right[4],
      'dock.drop.top': extra.right[5], 'dock.drop.bottom': extra.right[6],
      'tab.guide.title': right['tab.guide.title'] ?? '', 'tab.unavailable': right['tab.unavailable'] ?? '',
      'command.close': extra.commands[0], 'command.refresh': extra.commands[1], 'command.noRefresh': extra.commands[2],
      'command.toggle': extra.commands[3], 'command.fullscreen': extra.commands[4], 'command.noSession': extra.commands[5],
      'command.noFocus': extra.commands[6], 'command.stale': extra.commands[7], 'command.collapsed': extra.commands[8],
      'command.float': extra.commands[9], 'command.empty': extra.commands[10], 'command.budget': extra.commands[11],
      'command.width': extra.commands[12],
    },
    sidebarFiles: {
      ...files,
      'shortcut.noSession': extra.files[0], autoRefresh: extra.files[1],
      'autoRefresh.enable': extra.files[2], 'autoRefresh.disable': extra.files[3],
    },
    sidebarDocumentPreview: {
      loading: preview.loading ?? '', loadMore: preview.loadMore ?? '', changed: preview.changed ?? '',
      reloadNow: preview.reloadNow ?? '', reload: preview.reload ?? '',
      autoRefresh: extra.previewRefresh[0], 'autoRefresh.enable': extra.previewRefresh[1], 'autoRefresh.disable': extra.previewRefresh[2],
      'wrap.enable': extra.preview[0], 'wrap.disable': extra.preview[1], 'wrap.aria': extra.preview[2],
      openWith: extra.preview[3], 'viewer.text': extra.preview[4], resourceUnavailable: extra.preview[5], rendererUnavailable: extra.preview[6],
      unsupportedFile: extra.preview[7],
      'error.notFound': preview['error.notFound'] ?? '', 'error.tooLarge': preview['error.tooLarge'] ?? '',
      'error.notText': preview['error.notText'] ?? '', 'error.notRegularFile': preview['error.notRegularFile'] ?? '',
      'error.unavailable': preview['error.unavailable'] ?? '', retry: preview.retry ?? '',
    },
    documentMarkdown: { 'viewer.label': extra.markdown[0], 'code.copy': extra.markdown[1], 'code.copied': extra.markdown[2], footnotes: extra.markdown[3] },
    sidebarPdf: {
      ...zoom,
      title: extra.pdf[0], pageImage: extra.pdf[1], loading: extra.pdf[2], rendering: extra.pdf[3], failed: extra.pdf[4],
      password: extra.pdf[5], workerFailed: extra.pdf[6], unsupported: extra.pdf[7], retry: extra.pdf[8],
    },
    documentHtml: { title: extra.html[0], frame: extra.html[1], loading: extra.html[2], failed: extra.html[3] },
    sidebarCodePreview: { title: extra.code[0], copy: extra.code[1], copied: extra.code[2] },
    sidebarImage: {
      ...zoom,
      title: extra.image[0], preview: extra.image[1], loading: extra.image[2], failed: extra.image[3],
      unsupported: extra.image[4],
    },
  }
}

const ja = surface('ja', {
  right: ['右サイドバーを開く', '右サイドバーを閉じる', 'ここへ移動', '左に分割', '右に分割', '上に分割', '下に分割'],
  commands: ['現在のページまたはウィンドウを閉じる', '現在のページを更新', 'このページは更新できません', '右サイドバーの表示を切り替える', 'パネルの全画面表示を切り替える', '先にセッションを選択してください', '先に右サイドバーのパネルにフォーカスしてください', 'ページが切り替わりました。もう一度フォーカスしてください', '先に右サイドバーを開いてください', 'フローティングパネルではこの操作はできません', '先にページを開いてください', 'パネルは2つまでです', '分割するには幅が足りません。サイドバーを広げてください'],
  files: ['先にセッションを選択してください', '自動更新', '自動更新を有効にする', '自動更新を無効にする'],
  previewRefresh: ['自動更新', '自動更新を有効にする', '自動更新を無効にする'],
  zoom: ['ズーム操作', '倍率を選択', '縮小', '拡大', '幅に合わせる', '{percent}%'],
  preview: ['行を折り返す', '行の折り返しを解除', '行の折り返し', '表示方法', 'プレーンテキスト', 'ファイルリソースサービスを利用できません。', '{name} プレビューを利用できません。', 'このファイル形式はまだプレビューできません。'],
  markdown: ['Markdown', 'コピー', 'コピー済み', '脚注'],
  pdf: ['PDF', 'PDF の {page} ページ', 'PDF を開いています…', 'ページを描画しています…', 'PDF を表示できません：{message}', 'この PDF はパスワードが必要なため、プレビューできません。', 'PDF 描画プロセスを続行できません。再試行してください。', 'PDF のプレビューにはファイル全体が必要です。', '再試行'],
  html: ['HTML', 'HTML プレビュー', 'HTML を読み込んでいます…', 'HTML を表示できません。'],
  code: ['コード', 'コピー', 'コピー済み'],
  image: ['画像', '画像プレビュー：{name}', '画像を開いています…', '画像を表示できません。', '画像のプレビューにはファイル全体が必要です。'],
})
const ko = surface('ko', {
  right: ['오른쪽 사이드바 열기', '오른쪽 사이드바 접기', '여기로 이동', '왼쪽에 분할', '오른쪽에 분할', '위에 분할', '아래에 분할'],
  commands: ['현재 페이지 또는 창 닫기', '현재 페이지 새로고침', '이 페이지는 새로고침할 수 없습니다', '오른쪽 사이드바 전환', '패널 전체 화면 전환', '먼저 세션을 선택하세요', '먼저 오른쪽 패널에 포커스를 맞추세요', '페이지가 바뀌었습니다. 다시 포커스를 맞추세요', '먼저 오른쪽 사이드바를 펼치세요', '플로팅 패널에서는 이 작업을 사용할 수 없습니다', '먼저 페이지를 여세요', '패널은 최대 두 개입니다', '분할할 너비가 부족합니다. 사이드바를 넓히세요'],
  files: ['먼저 세션을 선택하세요', '자동 새로고침', '자동 새로고침 켜기', '자동 새로고침 끄기'],
  previewRefresh: ['자동 새로고침', '자동 새로고침 켜기', '자동 새로고침 끄기'],
  zoom: ['확대/축소 컨트롤', '확대/축소 비율 선택', '축소', '확대', '너비에 맞추기', '{percent}%'],
  preview: ['줄 바꿈 켜기', '줄 바꿈 끄기', '줄 바꿈', '다음으로 열기', '일반 텍스트', '파일 리소스 서비스를 사용할 수 없습니다.', '{name} 미리보기를 사용할 수 없습니다.', '이 파일 형식은 아직 미리 볼 수 없습니다.'],
  markdown: ['Markdown', '복사', '복사됨', '각주'],
  pdf: ['PDF', 'PDF {page}페이지', 'PDF 여는 중…', '페이지 렌더링 중…', 'PDF를 표시할 수 없음: {message}', '이 PDF에는 암호가 필요하여 미리보기를 지원하지 않습니다.', 'PDF 렌더링 프로세스를 계속할 수 없습니다. 다시 시도하세요.', 'PDF 미리보기에는 전체 파일 내용이 필요합니다.', '다시 시도'],
  html: ['HTML', 'HTML 미리보기', 'HTML 불러오는 중…', 'HTML을 표시할 수 없습니다.'],
  code: ['코드', '복사', '복사됨'],
  image: ['이미지', '이미지 미리보기: {name}', '이미지 여는 중…', '이미지를 표시할 수 없습니다.', '이미지 미리보기에는 전체 파일 내용이 필요합니다.'],
})
const es = surface('es', {
  right: ['Abrir barra lateral derecha', 'Contraer barra lateral derecha', 'Mover aquí', 'Dividir a la izquierda', 'Dividir a la derecha', 'Dividir arriba', 'Dividir abajo'],
  commands: ['Cerrar la página o ventana actual', 'Actualizar la página actual', 'Esta página no se puede actualizar', 'Alternar la barra lateral derecha', 'Alternar pantalla completa del panel', 'Selecciona primero una sesión', 'Enfoca primero un panel de la barra lateral derecha', 'La página cambió; vuelve a enfocarla', 'Expande primero la barra lateral derecha', 'Esta acción no está disponible en un panel flotante', 'Abre primero una página', 'El límite es de dos paneles', 'No hay ancho suficiente para dividir; ensancha la barra lateral'],
  files: ['Selecciona primero una sesión', 'Actualización automática', 'Activar actualización automática', 'Desactivar actualización automática'],
  previewRefresh: ['Actualización automática', 'Activar actualización automática', 'Desactivar actualización automática'],
  zoom: ['Controles de zoom', 'Elegir zoom', 'Alejar', 'Acercar', 'Ajustar al ancho', '{percent}%'],
  preview: ['Activar ajuste de línea', 'Desactivar ajuste de línea', 'Ajuste de línea', 'Abrir con', 'Texto sin formato', 'El servicio de recursos de archivos no está disponible.', 'La vista previa de {name} no está disponible.', 'La vista previa de este tipo de archivo aún no está disponible.'],
  markdown: ['Markdown', 'Copiar', 'Copiado', 'Notas al pie'],
  pdf: ['PDF', 'Página {page} del PDF', 'Abriendo PDF…', 'Renderizando página…', 'No se puede mostrar el PDF: {message}', 'Este PDF requiere contraseña y no se puede previsualizar.', 'El proceso de renderizado del PDF no puede continuar. Inténtalo de nuevo.', 'La vista previa del PDF necesita el archivo completo.', 'Reintentar'],
  html: ['HTML', 'Vista previa HTML', 'Cargando HTML…', 'No se puede mostrar el HTML.'],
  code: ['Código', 'Copiar', 'Copiado'],
  image: ['Imagen', 'Vista previa de imagen: {name}', 'Abriendo imagen…', 'No se puede mostrar la imagen.', 'La vista previa de la imagen necesita el archivo completo.'],
})
const fr = surface('fr', {
  right: ['Ouvrir la barre latérale droite', 'Réduire la barre latérale droite', 'Déplacer ici', 'Diviser à gauche', 'Diviser à droite', 'Diviser en haut', 'Diviser en bas'],
  commands: ['Fermer la page ou la fenêtre actuelle', 'Actualiser la page actuelle', 'Cette page ne peut pas être actualisée', 'Afficher ou masquer la barre latérale droite', 'Basculer le panneau en plein écran', 'Sélectionnez d’abord une session', 'Placez d’abord le focus sur un panneau de droite', 'La page a changé ; placez-y de nouveau le focus', 'Développez d’abord la barre latérale droite', 'Cette action est indisponible dans un panneau flottant', 'Ouvrez d’abord une page', 'Deux panneaux au maximum', 'Largeur insuffisante pour diviser ; élargissez la barre latérale'],
  files: ['Sélectionnez d’abord une session', 'Actualisation automatique', 'Activer l’actualisation automatique', 'Désactiver l’actualisation automatique'],
  previewRefresh: ['Actualisation automatique', 'Activer l’actualisation automatique', 'Désactiver l’actualisation automatique'],
  zoom: ['Commandes de zoom', 'Choisir le zoom', 'Dézoomer', 'Zoomer', 'Ajuster à la largeur', '{percent}%'],
  preview: ['Activer le retour à la ligne', 'Désactiver le retour à la ligne', 'Retour à la ligne', 'Ouvrir avec', 'Texte brut', 'Le service de ressources de fichiers est indisponible.', 'L’aperçu {name} est indisponible.', 'L’aperçu de ce type de fichier n’est pas encore disponible.'],
  markdown: ['Markdown', 'Copier', 'Copié', 'Notes de bas de page'],
  pdf: ['PDF', 'Page {page} du PDF', 'Ouverture du PDF…', 'Rendu de la page…', 'Impossible d’afficher le PDF : {message}', 'Ce PDF nécessite un mot de passe et ne peut pas être prévisualisé.', 'Le processus de rendu PDF ne peut pas continuer. Réessayez.', 'L’aperçu PDF nécessite le fichier complet.', 'Réessayer'],
  html: ['HTML', 'Aperçu HTML', 'Chargement du HTML…', 'Impossible d’afficher le HTML.'],
  code: ['Code', 'Copier', 'Copié'],
  image: ['Image', 'Aperçu de l’image : {name}', 'Ouverture de l’image…', 'Impossible d’afficher l’image.', 'L’aperçu de l’image nécessite le fichier complet.'],
})
const de = surface('de', {
  right: ['Rechte Seitenleiste öffnen', 'Rechte Seitenleiste einklappen', 'Hierher verschieben', 'Links teilen', 'Rechts teilen', 'Oben teilen', 'Unten teilen'],
  commands: ['Aktuelle Seite oder aktuelles Fenster schließen', 'Aktuelle Seite aktualisieren', 'Diese Seite kann nicht aktualisiert werden', 'Rechte Seitenleiste ein- oder ausblenden', 'Vollbildmodus des Panels umschalten', 'Wählen Sie zuerst eine Sitzung aus', 'Fokussieren Sie zuerst ein Panel der rechten Seitenleiste', 'Die Seite hat sich geändert; fokussieren Sie sie erneut', 'Klappen Sie zuerst die rechte Seitenleiste aus', 'Diese Aktion ist in einem schwebenden Panel nicht verfügbar', 'Öffnen Sie zuerst eine Seite', 'Es sind höchstens zwei Panels möglich', 'Zum Teilen ist die Breite zu gering; verbreitern Sie die Seitenleiste'],
  files: ['Wählen Sie zuerst eine Sitzung aus', 'Automatisch aktualisieren', 'Automatische Aktualisierung einschalten', 'Automatische Aktualisierung ausschalten'],
  previewRefresh: ['Automatisch aktualisieren', 'Automatische Aktualisierung einschalten', 'Automatische Aktualisierung ausschalten'],
  zoom: ['Zoomsteuerung', 'Zoom auswählen', 'Verkleinern', 'Vergrößern', 'An Breite anpassen', '{percent}%'],
  preview: ['Zeilenumbruch aktivieren', 'Zeilenumbruch deaktivieren', 'Zeilenumbruch', 'Öffnen mit', 'Nur Text', 'Der Dateiressourcendienst ist nicht verfügbar.', 'Die {name}-Vorschau ist nicht verfügbar.', 'Für diesen Dateityp ist noch keine Vorschau verfügbar.'],
  markdown: ['Markdown', 'Kopieren', 'Kopiert', 'Fußnoten'],
  pdf: ['PDF', 'PDF-Seite {page}', 'PDF wird geöffnet…', 'Seite wird gerendert…', 'PDF kann nicht angezeigt werden: {message}', 'Dieses PDF benötigt ein Passwort und kann nicht angezeigt werden.', 'Der PDF-Renderer kann nicht fortfahren. Bitte erneut versuchen.', 'Die PDF-Vorschau benötigt die vollständige Datei.', 'Erneut versuchen'],
  html: ['HTML', 'HTML-Vorschau', 'HTML wird geladen…', 'HTML kann nicht angezeigt werden.'],
  code: ['Code', 'Kopieren', 'Kopiert'],
  image: ['Bild', 'Bildvorschau: {name}', 'Bild wird geöffnet…', 'Bild kann nicht angezeigt werden.', 'Die Bildvorschau benötigt die vollständige Datei.'],
})
const ptBR = surface('pt-BR', {
  right: ['Abrir barra lateral direita', 'Recolher barra lateral direita', 'Mover para cá', 'Dividir à esquerda', 'Dividir à direita', 'Dividir acima', 'Dividir abaixo'],
  commands: ['Fechar a página ou janela atual', 'Atualizar a página atual', 'Esta página não pode ser atualizada', 'Alternar a barra lateral direita', 'Alternar tela cheia do painel', 'Selecione uma sessão primeiro', 'Foque primeiro um painel da barra lateral direita', 'A página mudou; foque nela novamente', 'Expanda primeiro a barra lateral direita', 'Esta ação não está disponível em um painel flutuante', 'Abra uma página primeiro', 'O limite é de dois painéis', 'Largura insuficiente para dividir; aumente a barra lateral'],
  files: ['Selecione uma sessão primeiro', 'Atualização automática', 'Ativar atualização automática', 'Desativar atualização automática'],
  previewRefresh: ['Atualização automática', 'Ativar atualização automática', 'Desativar atualização automática'],
  zoom: ['Controles de zoom', 'Escolher zoom', 'Reduzir', 'Ampliar', 'Ajustar à largura', '{percent}%'],
  preview: ['Ativar quebra de linha', 'Desativar quebra de linha', 'Quebra de linha', 'Abrir com', 'Texto simples', 'O serviço de recursos de arquivo não está disponível.', 'A visualização de {name} não está disponível.', 'A visualização deste tipo de arquivo ainda não está disponível.'],
  markdown: ['Markdown', 'Copiar', 'Copiado', 'Notas de rodapé'],
  pdf: ['PDF', 'Página {page} do PDF', 'Abrindo PDF…', 'Renderizando página…', 'Não foi possível exibir o PDF: {message}', 'Este PDF exige senha e não pode ser visualizado.', 'O processo de renderização do PDF não pode continuar. Tente novamente.', 'A visualização do PDF precisa do arquivo completo.', 'Tentar novamente'],
  html: ['HTML', 'Visualização de HTML', 'Carregando HTML…', 'Não foi possível exibir o HTML.'],
  code: ['Código', 'Copiar', 'Copiado'],
  image: ['Imagem', 'Visualização da imagem: {name}', 'Abrindo imagem…', 'Não foi possível exibir a imagem.', 'A visualização da imagem precisa do arquivo completo.'],
})
const ru = surface('ru', {
  right: ['Открыть правую боковую панель', 'Свернуть правую боковую панель', 'Переместить сюда', 'Разделить слева', 'Разделить справа', 'Разделить сверху', 'Разделить снизу'],
  commands: ['Закрыть текущую страницу или окно', 'Обновить текущую страницу', 'Эту страницу нельзя обновить', 'Показать или скрыть правую боковую панель', 'Переключить полноэкранный режим панели', 'Сначала выберите сеанс', 'Сначала переведите фокус на правую панель', 'Страница изменилась; снова переведите на неё фокус', 'Сначала разверните правую боковую панель', 'Это действие недоступно в плавающей панели', 'Сначала откройте страницу', 'Допускается не более двух панелей', 'Недостаточно ширины для разделения; расширьте боковую панель'],
  files: ['Сначала выберите сеанс', 'Автообновление', 'Включить автообновление', 'Отключить автообновление'],
  previewRefresh: ['Автообновление', 'Включить автообновление', 'Отключить автообновление'],
  zoom: ['Управление масштабом', 'Выбрать масштаб', 'Уменьшить', 'Увеличить', 'По ширине', '{percent}%'],
  preview: ['Включить перенос строк', 'Отключить перенос строк', 'Перенос строк', 'Открыть с помощью', 'Обычный текст', 'Служба файловых ресурсов недоступна.', 'Предпросмотр {name} недоступен.', 'Предпросмотр файлов этого типа пока недоступен.'],
  markdown: ['Markdown', 'Копировать', 'Скопировано', 'Сноски'],
  pdf: ['PDF', 'Страница PDF {page}', 'Открытие PDF…', 'Отрисовка страницы…', 'Не удалось показать PDF: {message}', 'Для этого PDF нужен пароль; предпросмотр не поддерживается.', 'Процесс отрисовки PDF не может продолжить работу. Повторите попытку.', 'Для предпросмотра PDF нужен полный файл.', 'Повторить'],
  html: ['HTML', 'Предпросмотр HTML', 'Загрузка HTML…', 'Не удалось показать HTML.'],
  code: ['Код', 'Копировать', 'Скопировано'],
  image: ['Изображение', 'Предпросмотр изображения: {name}', 'Открытие изображения…', 'Не удалось показать изображение.', 'Для предпросмотра изображения нужен полный файл.'],
})

/** Replacement namespaces remove the obsolete text-preview surface and match rc.1 exactly. */
export const COMMUNITY_SURFACE_TRANSLATIONS = { ja, ko, es, fr, de, 'pt-BR': ptBR, ru } as const
