# @deepseek-ai/dsh-client-ui-desktop-shell

[English](README.md) | 中文

桌面宿主偏好与 Release 发现功能的 Electron 专属浏览器 UI。存在 `window.deepSeekHarnessDesktop` 时，插件向“通用设置”贡献关闭行为、原生通知、macOS 登录启动和桌面版本设置行，并在“设置”入口上方贡献可用版本操作。普通 `dsh web` 浏览器不会收到任何贡献。

所有高权限操作均由 preload bridge（预加载桥）持有。本包接收规范化偏好与 Release 状态，请求受白名单限制的偏好更改，并可要求主进程打开选定的 `flaqai/open-deepseek-harness-desktop` Release 页面。它不能读取任意文件、运行命令、选择任意外部 URL、下载安装程序或更新应用。

## Model Experience

无，因为本插件只改变桌面界面与应用偏好，不增加会话事件、模型上下文、工具或模型可见输出。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## Known Limitations and Deferred Work

- 登录启动仅在已打包的 macOS 应用中可用；Windows 与 Linux 会把该能力报告为不可用。
- Release 发现只提供下载页面链接；已签名的自动下载、安装、回退与深链接留待后续实现。
