<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Icono de Open DeepSeek Harness Desktop">
</p>

<h1 align="center">Open DSH Desktop</h1>

<p align="center">
  <strong>Una edición de escritorio de DeepSeek Harness lista para usar y con dependencias más seguras</strong>
</p>

Idiomas: [English](README.en.md) · [简体中文](README.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · Español · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

> Estamos solucionando los errores reportados por los usuarios. Muy pronto llegará una nueva versión que combinará las actualizaciones oficiales, correcciones de errores y mejoras en la experiencia…

Open DeepSeek Harness Desktop es una distribución de escritorio independiente, mantenida por la comunidad, de [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) para macOS, Windows y Linux. Electron no crea un segundo entorno de Agent: inicia y supervisa de forma segura el Harness Host local y muestra el cliente Web existente.

Este repositorio no es un producto oficial de DeepSeek. Está en desarrollo activo, por lo que sus funciones, paquetes y formatos de datos locales pueden cambiar.

## Funciones principales

- Host de escritorio con supervisión de Harness, bandeja, notificaciones, acceso a registros y recuperación de errores de inicio.
- Detección de conflictos de dependencias antes de ejecutar plugins y aislamiento únicamente del plugin que no pueda repararse con seguridad.
- Plugin Marketplace, conexiones IM y selector de Skills preconfigurados en el primer inicio y desinstalables.
- Provider oficial de Codex y runtime de Codex específico para cada sistema operativo y CPU.
- Once temas, fondos de chat, imágenes locales, idioma y configuración de modelos.
- Conexión con WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord y WhatsApp.
- Paquetes separados para macOS Apple Silicon/Intel, Windows x64 y Linux x64.

## Instalación

Descarga el paquete adecuado desde [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases). Los paquetes de macOS tienen firma ad-hoc y no están notarizados, por lo que Gatekeeper puede mostrar una advertencia la primera vez. Verifica siempre el origen y sigue las instrucciones de la página de la versión.

## Tokens de API para probar gratis

- [Agnes AI](https://agnes-ai.com/): Base URL compatible con OpenAI `https://apihub.agnes-ai.com/v1`; `agnes-2.5-flash` es una opción actual para Agents, programación, razonamiento y herramientas.
- [OpenRouter · Ox Alpha](https://openrouter.ai/stealth/ox-alpha?view=api): Base URL `https://openrouter.ai/api/v1` y modelo `stealth/ox-alpha`.

Son servicios externos independientes. Sus cuotas gratuitas, precios, modelos, límites y políticas de datos pueden cambiar. Guarda las claves en el almacén de credenciales de Harness y nunca las publiques en Issues, capturas o archivos controlados por Git.

## Documentación

Consulta el [README en inglés](README.md) o el [README en chino simplificado](README.zh.md) para ver todas las funciones, límites de seguridad, paquetes y agradecimientos. La arquitectura de Harness se describe en la [documentación oficial](docs/architecture.md).

## Equipo FLAQ AI

El equipo FLAQ AI mantiene este proyecto a partir de su experiencia práctica con integración de modelos, entornos Agent locales, distribución de plugins y aplicaciones multiplataforma. [FLAQ.AI](https://flaq.ai/) ofrece acceso API unificado a modelos de imagen, vídeo, música y lenguaje para Agents y aplicaciones de producción. FLAQ.AI es opcional y no es necesario para ejecutar este software.

## Licencia

[MIT License](LICENSE). Las licencias de terceros están documentadas en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
