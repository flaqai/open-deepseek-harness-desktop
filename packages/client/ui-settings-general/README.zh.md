# @deepseek-ai/dsh-client-ui-settings-general

[English](README.md) | 中文

设置外壳、无特定功能归属文案与持久化产品引导 namespace。它以触发控件和模态设置面板占用 `sidebar.settings`，把 `settings.section` 账本投影成导航、把 `settings.onboarding` 账本投影成每次只挂载一个步骤的引导流程，并在设置页面上注册所有不属于单一功能的内容：触发器、标题栏与关闭控件内容、本地配置文件操作，「通用」分区及其 `settings.general.item` slot，以及 `settings` 字典。它渲染进的那些 slot 类型归 ui-settings——设置领域底座——所有；只有外壳自身的契约类型放在这里，因为它们引用 ui-sidebar 的 slot 类型，而底座不得依赖任何 `ui-*` 包。归具体功能所有的行（「权限」、「语言」、「外观」）、分区（「模型」）和条件式首次使用引导步骤仍由各自的功能包提供。

外壳只拥有可复用引导设置框架的文案；任务总览与功能文案仍来自注册方。导航 label 可以是跟随语言的 thunk，因此导航投影经 `resolveSlotLabel` 解析，并在分区账本更新或 locale revision 变化时重新渲染（`ctx.get('locale')` 可选读取，无硬 locale 依赖）。首次使用引导记录按升序投影，每次只挂载一个步骤；可见步骤自行持有总览弹窗和应用根节点 `inert` 生命周期。已挂载但仍在判定私有事实的步骤渲染 null，因此判定期间不绘制也不阻塞任何内容。当前注册方会收到该条目的 id、`complete()` 和 `openSection({ sectionId, subsectionId?, step, complete })` 回调。外壳随后在不显示普通设置导航的三步框架内渲染已有设置分区；“返回步骤”不会改变任务状态，“完成此项”则调用注册方回调并返回总览。持久化完成状态、能力就绪状态、任务文案与变更操作仍由注册方持有，因此独立注册的流程无法堆叠，外壳也不会成为第二个配置事实来源。

回环浏览器通过 `settings.describe` 加载提供方的 `hasDocument` 能力，且只有在 Host 确认可准备好一份由提供方持有的本地文档时才渲染**打开配置文件**。该操作发送无路径参数且仅限回环访问的 `settings.openDocument` 请求；Host 会再次解析提供方路径、在文档缺失时将其创建出来，并交给原生文本编辑器（macOS 上使用 `open -t`，绕过浏览器文件关联；Linux 和 Windows 上使用桌面文件关联；WSL 上经 `wslpath -w` 转换后使用 Windows 文件关联）。打开失败时该操作仍可使用，并渲染本地化错误。临时读取失败或 Host 拓扑变化后，重新打开对话框或重新连接会刷新可用性。远程浏览器从不注册该操作，也从不发起这项特权设置读取。

宿主端在用户设置 seam 中注册 `ui-onboarding`。`ui-settings-models` 提供的设置向导通过既有公开 settings 边界读写其中的 `welcomeNoticeVersion`；外壳本身仍不持有产品策略。

在 Electron 桌面宿主中，preload bridge 会向「通用设置」提供官方 Harness 源码更新行。该行检查当前与稳定提交标识，解释工作树未提交、分叉、安装包和网络失败状态，对可执行更新进行确认，并且只有在桌面进程报告事务式构建成功后才提供重启。普通 Web 客户端没有 preload bridge，因此不会注册这项特权操作。

## 模型体验

无。该插件渲染浏览器设置 UI；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 桌面源码升级器仅适用于 Git 源码运行模式。安装包更新需要由桌面宿主持有的签名发布通道。
