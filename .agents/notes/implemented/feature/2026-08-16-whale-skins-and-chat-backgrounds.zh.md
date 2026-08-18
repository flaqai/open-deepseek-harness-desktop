# Agent Note: 蓝鲸皮肤与浏览器本地聊天背景

Status: implemented

[English](2026-08-16-whale-skins-and-chat-backgrounds.md) | 中文

## Problem

桌面应用只有浅色、深色和跟随系统三种外观选择。用户无法选择产品皮肤，也不能在不修改仓库 CSS 的前提下用插画个性化会话。若把上传图片当作附件或 Host 设置，还会把不需要进入模型或服务器路径的私密装饰数据带入这些路径。

## Decision

`ui-theme` 在现有配色偏好之外提供七个完整产品皮肤：`ocean`、`moonlight`、`bubble`、`starlight`、`pirate`、`shinobi` 与 `rift`。它们仍是普通 `ThemeDefinition` 条目，并通过 `ui-theme.preference` 持久化，因此所有 UI 包继续消费语义 token，无需使用皮肤专属选择器。

聊天背景的状态和持久化与配色相互独立。默认 Web 应用拥有三张原创鲸鱼 WebP 资产和五张原创主体插画。背景可以携带 `focus-left` 或 `focus-right` 布局元数据；ui-layout 是唯一 DOM 写入方，ui-conversation 将工作区放在低细节画面之上，并沿指定外侧露出主体。窄布局会把侧边处理替换成更强的均匀可读性遮罩。[`inspiration-collage` 精选配对](2026-08-17-inspiration-collage-paired-skin.md)允许设置行中的一次操作选择匹配的配色和背景，但不会耦合两者的运行时或持久化路径。

自定义 PNG、JPEG 或 WebP 在浏览器内解码和缩小，再编码为有大小上限的 WebP data URL，并保留在浏览器本地存储。源文件和编码结果都有上限。自定义图片绝不会进入 Host settings、会话事件、附件或模型请求。

## Alternatives considered

- **把上传图片写入 `$DSH_HOME/settings.yaml`：** 否决，因为大段二进制字符串会膨胀供人工编辑的共享设置文档，并让装饰性私密数据穿过 Host API。
- **由 React 设置行直接应用背景样式：** 否决，因为这会在 ui-layout 的 ThemePresenter 之外产生第二个 DOM 写入方，并且在重载后丢失恢复路径。
- **创建桌面专属主题实现：** 否决，因为 Electron 应用渲染的就是同一个 Web 客户端；共享客户端插件能够保持浏览器和桌面行为一致，且不会复制状态。
- **复用现有 DeepSeek 品牌插画：** 否决，因为项目需要来源清楚、可随 MIT 项目再分发的资产。内置鲸鱼插画是项目原创资产，不包含复制的标志。
- **内置具名动漫或游戏 IP 的美术资产：** 否决，因为角色形象、服装、标志及其他可识别表达不能随项目的 MIT 许可证再分发。新增四张背景是原创类型化设计，不复制角色、名称、徽记、地图或战队标志；用户仍可上传自己有权使用的图片。

## Consequences

用户获得十一种配色选择、八张内置插画背景和一个本地自定义背景，同时会话与模型行为保持不变。自定义图片不会跨浏览器同步，清除浏览器存储后也会消失。不接受 GIF 和 SVG 源文件，默认应用必须继续提供 `/theme-backgrounds/` 下的八个路径。

聚焦测试覆盖配色注册、背景持久化、设置动作、DOM 投射和撤销。装配后的 Web 快照与真实服务器浏览器录制覆盖可见的选择流程。
