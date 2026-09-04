<p align="center"><img src="./apps/desktop/src/icon.png" width="112" alt="Icono de Open DeepSeek Harness Desktop"></p>

# Open DeepSeek Harness Desktop

<p align="center"><strong>La edición comunitaria de escritorio de DeepSeek Harness, lista para usar y con dependencias más seguras</strong></p>

Idiomas: [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · Español · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

> [!IMPORTANT]
>
> **[v0.1.2-rc.1 ya está disponible: descárgala y pruébala](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).** Esta versión se basa en DeepSeek Harness 0.1.2-rc.1, añade menús nativos y flujos protegidos para reiniciar y salir, mejora los iconos del Dock y la barra de menús de macOS y corrige el alcance del proxy del sistema para Codex y el inicio de Profiles personalizados.
>
> Esta es una versión candidata preliminar. Haz una copia de seguridad de la configuración importante antes de actualizar y adjunta registros o informes de diagnóstico al comunicar problemas.

Open DeepSeek Harness Desktop es una distribución independiente y mantenida por la comunidad de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Los instaladores incluyen Node.js, pnpm y el runtime de Harness, de modo que puedes configurar modelos, ejecutar sesiones de programación, inspeccionar la ejecución, administrar plugins y Skills, y conectar herramientas externas o bots IM sin preparar un entorno de desarrollo.

> [!NOTE]
>
> Este repositorio no es un producto oficial de DeepSeek. Sigue en fase preliminar y pueden evolucionar el formato de datos, las políticas de compatibilidad y la instalación.

## Funciones principales actuales

- Espacio de conversación con ancho ajustable, navegación por turnos, uso exacto de Token y cola de envío.
- Importación a un entorno independiente, uso compartido de un directorio existente o inicio desde cero.
- Descubrimiento de plugins con catálogo real, categorías, estado local e instalación directa.
- Diagnóstico previo al arranque, ejercicios, cuarentena y recuperación para pnpm, Cordis y Loader.
- Navegación de Ajustes desplazable, reordenable y persistente.
- Distribuciones nativas e integración de escritorio para Windows, macOS y Linux.

## Espacio de conversación con IA

Las respuestas terminadas pueden plegar el proceso y el System Prompt. Se puede ajustar el ancho y el tamaño del texto; las tablas Markdown escalan con el contenido, y la navegación compacta por turnos, el uso exacto de Token por respuesta y el resaltado continuo del código facilitan revisar conversaciones largas.

El historial usa tarjetas que distinguen respuestas completadas, canceladas e interrumpidas. Los borradores se conservan al cambiar de sesión y es posible añadir el siguiente mensaje a la cola mientras una sesión continúa. Las imágenes aparecen inmediatamente mientras la compresión y la subida siguen en segundo plano; también se admiten imágenes en la traza, archivos locales subidos y referencias de archivo o sesión que sobreviven a la edición del texto cercano.

## Primer inicio y entornos de datos independientes

En el primer inicio, el cliente comprueba el directorio oficial predeterminado ~/.dsh. Si no existe o no es compatible, puedes seleccionar manualmente otro directorio admitido o crear un entorno vacío propiedad de Desktop.

### Importar a un entorno independiente

Copia configuración, credenciales, sesiones, información de espacios de trabajo, presets de Agent, Skills y estado de conexiones sin modificar el origen. No copia Profiles, node_modules, archivos de bloqueo, runtimes de plugins, registros de cuarentena o salud ni identificadores anónimos. Los plugins se reinstalan en el Profile de Desktop y los cambios posteriores quedan separados del CLI/Web oficial.

<p align="center"><img src="./assets/readme/data-home-import-en.png" width="900" alt="Importar una configuración oficial de DSH a un entorno independiente"><br><sub>Se copian los datos compatibles y se conserva intacto el origen</sub></p>

### Usar esta configuración directamente

Usa el directorio oficial ~/.dsh u otro directorio compatible sin crear una copia. La configuración, las credenciales, las sesiones, los presets, las Skills, los Profiles y los plugins quedan compartidos; Desktop y CLI/Web modifican los mismos datos.

<p align="center"><img src="./assets/readme/data-home-reuse-en.png" width="900" alt="Usar directamente una configuración DSH existente"><br><sub>Desktop comparte los datos del directorio seleccionado</sub></p>

### Empezar desde cero

Crea un directorio independiente y vacío sin leer ni importar configuración, sesiones o plugins existentes.

<p align="center"><img src="./assets/readme/data-home-fresh-en.png" width="900" alt="Crear un entorno DSH independiente y limpio"><br><sub>No se lee ni modifica ninguna configuración DSH existente</sub></p>

### Elegir un directorio de datos independiente

Tanto **Importar a un entorno independiente** como **Empezar desde cero** permiten elegir antes de continuar entre la ubicación administrada predeterminada y una carpeta vacía personalizada. Esa carpeta se convierte en la raíz de datos independiente del cliente; el origen no se modifica ni se sincroniza. En Windows, las sesiones, los Profiles de plugins y otros datos crecientes pueden guardarse en D: u otra unidad no perteneciente al sistema para reducir la presión sobre C:.

<p align="center"><img src="./assets/readme/data-home-import-custom-location-zh.png" width="900" alt="Elegir un directorio vacío al importar configuración"><br><sub>Importación independiente: elegir la ubicación predeterminada o una carpeta vacía antes de copiar</sub></p>

<p align="center"><img src="./assets/readme/data-home-fresh-custom-location-zh.png" width="900" alt="Elegir un directorio vacío al empezar desde cero"><br><sub>Empezar desde cero: guardar los nuevos datos independientes donde elija el usuario</sub></p>

Después de completar la configuración inicial, el directorio de datos todavía se puede cambiar desde **Ajustes → Ajustes generales**. Se puede volver al directorio independiente del cliente, usar directamente el `~/.dsh` oficial, elegir otro directorio DSH existente o crear una configuración nueva en una carpeta vacía. El cambio solo selecciona el directorio que se usará tras reiniciar; no copia, mueve, combina ni elimina los datos originales. Una carpeta vacía vuelve a iniciar el proceso de primera instalación después del reinicio.

<p align="center"><img src="./assets/readme/data-home-switch-after-start-zh.png" width="900" alt="Cambiar el directorio de datos desde Ajustes generales después de entrar"><br><sub>Cambiar de forma segura a una configuración existente o crear otra independiente en una carpeta vacía</sub></p>

Después, el asistente permite configurar la API Key del modelo, conectar el acceso desde el teléfono, preparar bots IM como WeChat o Feishu y conectar Codex opcionalmente. Todos los pasos se pueden omitir y completar más tarde en Ajustes.

## Descubrimiento, instalación y actualización de plugins

«Explorar plugins» consulta el catálogo real de Plugin Marketplace, no una lista fija. Las vistas populares y por categoría muestran Stars, descargas de los últimos 30 días y el estado de instalación local. Los plugins se pueden instalar mediante el flujo controlado o abrir en el mercado completo para consultarlos y administrarlos.

El catálogo se guarda durante 24 horas después de una consulta correcta, por lo que cambiar de categoría no vuelve a descargarlo; el usuario puede forzar una actualización. El estado instalado se obtiene por separado cada vez que se abre la ventana. Los fallos de red muestran la causa real y, si existe una caché antigua, permiten seguir explorando con una advertencia. Los plugins locales conservan información verificable del paquete o repositorio, de modo que el mercado puede identificar el origen en línea y ofrecer **Restaurar**; el origen local no se actualiza directamente y debe restaurarse como versión en línea para participar en las comprobaciones normales.

## Selección y restauración de plugins importados

La importación independiente copia la configuración y una lista de restauración, pero nunca adopta el antiguo node_modules. La pantalla muestra estos estados:

- **Proporcionado por el cliente**: un preset incluido ya satisface el plugin.
- **Comprobando**: el origen se resuelve en un directorio temporal sin tocar el Profile activo.
- **Disponible en línea**: puede reinstalarse con el pnpm incluido.
- **Origen en línea no disponible**: no existe el paquete, repositorio o Git ref.
- **No se puede comprobar temporalmente**: desconexión, tiempo agotado, autenticación o límite de solicitudes; se puede reintentar.

Si el origen en línea no está disponible, el usuario puede elegir un directorio fuente o un .tgz. El cliente valida nombre del paquete, rutas del archivo, manifest y tamaño; los directorios se vuelven a empaquetar con scripts de ciclo de vida desactivados. Toda restauración pasa por permisos de compilación, diagnóstico de dependencias compartidas y cuarentena cuando sea necesaria. Nunca se copia el node_modules antiguo ni se ejecutan directamente direcciones con credenciales o especificaciones desconocidas.

<p align="center"><img src="./assets/readme/imported-plugin-restore-zh.png" width="900" alt="Comprobación de origen y restauración local de plugins importados"><br><sub>Estado del origen, restauración en línea y restauración local protegida</sub></p>

## Diagnóstico superreforzado

Los plugins de terceros comparten el proceso Node.js y el grafo de servicios Cordis del Host. Una dependencia transitiva, la forma en que pnpm crea enlaces o una entrada antigua del Loader puede provocar llamadas de herramientas vacías, errores .prepare o una lista de plugins ausente antes incluso de que Ajustes pueda abrirse.

Por eso el diagnóstico vive en la composición del Profile y en el arranque, no en otro plugin ordinario. Antes de ejecutar código de terceros lee el manifest, pnpm-lock.yaml, los ajustes del Workspace, el orden de Bundles, el grafo instalado real y el runtime compartido de la instalación actual.

### De la cuarentena al arrancar a una reparación accionable

La protección abarca el arranque y la interfaz principal: primero identifica y retira el plugin incompatible, después informa con claridad de lo aislado y finalmente muestra la causa, la versión original y acciones concretas para actualizar o desinstalar.

<p align="center"><img src="./assets/readme/diagnostics-startup-quarantine-zh.png" width="900" alt="Aislamiento de dsh-font incompatible durante el arranque"><br><sub>Detectar y aislar un plugin incompatible durante el arranque</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-quarantine-notice-zh.png" width="900" alt="Aviso de plugins aislados tras el arranque"><br><sub>Entrar con seguridad y mostrar exactamente qué se aisló</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-repair-guidance-zh.png" width="900" alt="Causa y acciones de reparación en Diagnóstico"><br><sub>Mostrar causa, versión, origen anterior y opciones de recuperación</sub></p>

Los Context, Service y Symbol de Cordis dependen de la identidad física del módulo, no solo de su versión. Dos copias de @deepseek-ai/cordis o dsh-tools con la misma versión pero distinto real path siguen siendo instancias JavaScript diferentes. La inspección recorre cada plugin raíz, sus dependencias directas y transitivas, rangos declarados y rutas finales; los peerDependencies válidos no se marcan como error.

Se comprueban los singletons compartidos del Host, la coherencia entre Profile y lockfile, Bundles huérfanos o duplicados, plugins fantasma, el Store de pnpm, instalaciones incompletas, allowBuilds, permisos de prepare y configuración de deduplicación peer.

El orden de reparación es **inspección de solo lectura → convergencia sin pérdida → instalar solo lo necesario → volver a comprobar real paths → cuarentena si hace falta**. Un Profile sano no ejecuta pnpm. Los overrides administrados link: solo se usan cuando el rango es compatible y nunca reducen minimumReleaseAge ni anulan allowBuilds: false. Un comando pnpm correcto no basta: el arranque continúa únicamente cuando las rutas físicas y el Loader vuelven a ser coherentes.

Si la convergencia no puede demostrarse segura, solo se retira el plugin raíz responsable de las dependencias activas y del orden de Bundle. Se conservan su especificación, versión, cadena, motivo y fecha. La cuarentena termina únicamente cuando el paquete ha salido físicamente del Profile, los Host compartidos apuntan a las copias canónicas y la reinspección es correcta. El objetivo es explicar quién falló, por qué, qué protección se aplicó y cuál es el siguiente paso.

Diagnóstico muestra el plugin responsable, su versión, el motivo de la cuarentena y un resumen de la cadena de dependencias. El usuario puede volver a enlazar y recuperar, aprobar el elemento de build identificado, buscar una actualización compatible en el mercado o desinstalar por completo. El plugin solo vuelve al runtime después de superar de nuevo la inspección.

### Centro de ejercicios de diagnóstico

Las versiones de desarrollo e instalada incluyen muestras sin conexión que reproducen copias Host duplicadas, Bundles huérfanos, módulos ausentes, Patch inválidos, Loader duplicados, fallos de ciclo de vida, permisos de build bloqueados y reparaciones interrumpidas. Los escenarios seleccionados se ejecutan en orden y muestran el escenario y la fase actuales, los escenarios restantes, el resultado y la duración. El destino aislado no modifica el Profile del usuario; el modo avanzado con Profile real restaura y reinspecciona al terminar. Si no puede demostrar una recuperación limpia, no reinicia los plugins; guarda resúmenes JSON y de texto anonimizados y permite exportar el informe JSON.

<p align="center"><img src="./assets/readme/diagnostics-lab-sandbox-zh.png" width="900" alt="Escenarios del entorno aislado de Diagnóstico"><br><sub>Entorno aislado: ensayar fallos sin modificar el Profile del usuario</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-lab-live-profile-zh.png" width="900" alt="Modo avanzado con Profile real"><br><sub>Profile real avanzado: verificar cuarentena, recuperación y reinspección</sub></p>

> [!CAUTION]
>
> No se garantiza que el ejercicio con el Profile real termine correctamente en esta versión. Haz una copia de seguridad de la configuración o usa un directorio de datos aislado antes de ejecutarlo, ya que existe un riesgo considerable de cierre inesperado. No uses este modo en producción. Si necesitas una prueba real, activa solo un escenario cada vez.

## Selección de texto y menú contextual

Al seleccionar texto de solo lectura en mensajes, resultados de herramientas, detalles o vistas previas aparece una barra horizontal. Al hacer clic derecho sobre la selección aparece un menú vertical redondeado.

- **Copiar**: escribe la selección en el portapapeles.
- **Preguntar en una conversación nueva**: crea una conversación y rellena la pregunta sin enviarla automáticamente.
- **Añadir a la conversación actual**: agrega una cita Markdown después del borrador existente sin reemplazarlo.

Si la sesión espera una elección, confirmación o respuesta, o el editor está desactivado, la opción de añadir a la conversación actual se oculta automáticamente.

<p align="center">
  <strong>Barra de selección</strong><br>
  <img src="./assets/readme/selection-toolbar-zh.png" width="900" alt="Barra horizontal tras seleccionar texto">
</p>

<p align="center">
  <strong>Menú contextual</strong><br>
  <img src="./assets/readme/selection-context-menu-zh.png" width="900" alt="Menú vertical al hacer clic derecho">
</p>

## Experiencia de escritorio

- Ejecución en bandeja, salida completa y reinicio rápido desde la barra de menús de macOS o la bandeja de Windows/Linux.
- Notificaciones de fallo y recuperación, acceso al registro fijo de Harness y ayuda cuando el inicio tarda más de 15 segundos.
- Comprobación de Releases, progreso de descarga, validación de SHA256SUMS y apertura del instalador desde Ajustes generales.
- Registro y eliminación segura del comando dsh incluido en el PATH del sistema.
- Barra de título personalizada en Windows/Linux, comportamiento nativo de macOS y acceso limitado de escritura al portapapeles.
- Codex y Claude Code se instalan bajo demanda desde Ajustes → Herramientas externas, no se incluyen en el instalador.

### Plugins predefinidos

El instalador incluye cinco presets de inicio como archivos locales con integridad verificada: Plugin Marketplace, dsh-im, dsh-skill-picker, Better Sidebar y dsh-pocket. `dsh-font` se proporciona únicamente como muestra para los ejercicios de diagnóstico. Si el usuario desinstala un preset, el cliente no lo reinstala automáticamente.

<p align="center"><img src="./assets/readme/preset-mobile-access-zh.png" width="900" alt="Conectar un teléfono mediante el QR o la dirección LAN de Pocket"><br><sub>Acceso móvil: escanear en la misma red y habilitar acceso público solo cuando sea necesario</sub></p>

<p align="center"><img src="./assets/readme/preset-im-robot-zh.png" width="900" alt="Conectar bots de WeChat y otros servicios mediante dsh-im"><br><sub>Bots IM: WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord y WhatsApp</sub></p>

La versión local incluida facilita la preparación sin conexión, pero no sigue directamente las actualizaciones del mercado. Al conectarse, se recomienda abrir **Mercado de plugins → Instalados** y pulsar **Restaurar** en cada preset para sustituirlo por la versión en línea. La restauración no puede deshacerse automáticamente; se puede conservar la versión local si se prefiere un paquete fijo sin conexión.

<p align="center"><img src="./assets/readme/preset-plugin-restore-online-zh.png" width="900" alt="Restaurar presets locales como versiones en línea"><br><sub>Recomendado: restaurar al conectarse para participar en las comprobaciones normales de actualización</sub></p>

### Navegación de Ajustes personalizable

La navegación izquierda de Ajustes tiene desplazamiento propio para que las secciones añadidas por plugins no queden recortadas. Las secciones se pueden arrastrar y su orden se guarda localmente, conservándose de forma estable al instalar o quitar plugins. En Windows y Linux, la barra de título y el contenido de Harness usan vistas nativas separadas, por lo que un plugin a pantalla completa no puede cubrir los controles de la ventana.

<p align="center"><img src="./assets/readme/settings-navigation-reorder-zh.png" width="900" alt="Reordenar Ajustes con los tiradores de tres líneas"><br><sub>Arrastra libremente las secciones; las demás filas dejan espacio con suavidad y se guarda el orden final</sub></p>

## Temas y fondos

Admite sistema, claro, oscuro y ocho temas de producto, ocho ilustraciones incluidas y fondos PNG/JPEG/WebP locales. Las imágenes personalizadas permanecen en el almacenamiento local del navegador y no se envían al modelo.

<table><tr><th width="50%">Temas</th><th width="50%">Fondos</th></tr><tr><td align="center"><img src="./assets/readme/theme-settings-en.png" alt="Ajustes de temas"></td><td align="center"><img src="./assets/readme/background-settings-en.png" alt="Ajustes de fondos"></td></tr></table>

## Descargar e instalar

Descarga el archivo apropiado desde [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).

| Sistema | Arquitectura | Paquete |
| --- | --- | --- |
| macOS | Apple Silicon arm64 | DeepSeek-Harness-macos-arm64.dmg |
| macOS | Intel x64 | DeepSeek-Harness-macos-x64.dmg |
| Windows | x64 | DeepSeek-Harness-windows-x64.exe |
| Linux | Debian / Ubuntu x64 | DeepSeek-Harness-linux-x64.deb |
| Linux | Fedora / RHEL x64 | DeepSeek-Harness-linux-x64.rpm |

Verifica los archivos con SHA256SUMS. Las compilaciones de macOS usan firma ad-hoc y no están notarizadas; si Gatekeeper las bloquea, usa **Ajustes del sistema → Privacidad y seguridad → Abrir igualmente**. Windows puede mostrar una advertencia de reputación para una compilación nueva o sin firma.

## Ejecutar desde el código fuente

Instala Node.js ^22.19.0 o 24+ y pnpm 11.7.0:

    git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
    cd open-deepseek-harness-desktop
    pnpm install
    pnpm run build
    pnpm run dev:desktop

Para Web usa pnpm dsh web. Web desde código usa el DSH_HOME actual (normalmente ~/.dsh); Desktop instalado usa el directorio elegido al primer inicio. Compartir datos depende de esa elección.

## Seguridad, comunidad y licencia

El renderer desactiva la integración de Node y activa context isolation y el sandbox de Chromium. La navegación se limita al origen loopback exacto de Harness y no existe un bridge genérico para comandos, archivos o URL arbitrarias. Guarda las API Key mediante el servicio de credenciales de Harness.

- [Guía de usuario](docs/user/guide/index.md), [guía de plugins](docs/user/develop/framework/index.md), [guía de Skills](docs/subsystems/skills.md)
- Errores y propuestas: [GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues)
- Proyecto original: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Open DeepSeek Harness Desktop se publica bajo la [Licencia MIT](LICENSE). Consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para las licencias de terceros.

## Friends

- [DSHFind](https://dshfind.com/zh) — comunidad china de aprendizaje y recursos de DeepSeek Harness.
