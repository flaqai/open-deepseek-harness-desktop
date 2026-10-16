# 官方 alpha.4 社区集成验收

## 范围

目标固定为 `dsh-v0.2.1-alpha.4`，工作分支为 `merge/upstream-0.2.1-alpha.4`；合并前社区基线由 `backup/pre-upstream-0.2.1-alpha.4` 保留。精确提交及运行产物见本地 `.artifacts/alpha4-integration-baseline.json`。用户授权桌面开发版本同步为 `0.2.1-alpha.4`，本任务不打包、推送、创建标签或公开发布。

## 冲突处理台账

最初 52 个冲突路径及 67 个自动合并重叠路径的范围见[合并规划](2026-10-16-alpha4-merge-plan.md)。当前没有未解决的 index 冲突或源码冲突标记。

| 类别 | 处理与依据 |
| --- | --- |
| 28 个修改／删除冲突 | 保留社区删除的官方旧桌面、安装器与发布流程，避免恢复双实现 |
| 新增旧发布实现 | 删除无社区调用方的目录报告、发布摘要和三个仅验证已删除工作流的测试；保留社区 Windows 工作流测试 |
| 核心与子进程 | 保留常驻服务授权，接入 Linux ScopeSelector；桌面启动适配保留探测返回的启动参数，包括旧 systemd 的空数组 |
| 启动与插件兼容 | 消费方迁移到 `requirements`；真实 Loader 测试覆盖 `engines.dsh` 优先级和精确豁免；保留社区候选回滚和市场授权隔离 |
| 客户端 | 同时保留社区包操作与 Discover slot；接入 HostReleasePrompt 和 command chip 协议，保留团队引导、审批语言、手机布局和模型搜索 |
| NAS | 新市场读取、修改、安装和事件均不加入受限角色允许清单；直接 RPC、HTTP 和事件测试验证管理员与受限设备行为 |
| 产品统计 | 新环境采集仅在显式设置 `includeEnvironment: true` 后运行，默认保留此前身份与版本范围；没有扩大默认采集 |
| 依赖与文档 | 使用固定 pnpm 重建锁文件并通过供应链验证；生成目录从最终源码重建，中英文配对同步 |
| 外部工具 | 已发布 alpha.3 清单保持不变；新开发版本单独建立清单，严格检查发布 Provider 的引擎或 peer 要求，不添加兼容豁免 |

## 已有验证证据

本次使用源码中固定的归档，没有隐式刷新到 registry 最新版。正常启动的九项预装如下；此前发布包曾使用不同的刷新快照，不能用它替代本次源码清单。

| 预装 | 固定版本 | 本次检查 |
| --- | --- | --- |
| dshmarket | 1.66.8 | integrity、依赖声明、Profile 部署与正常启动 |
| @xmanrui/dsh-im | 4.34.2 | integrity、依赖声明、Profile 部署与正常启动 |
| dsh-better-sidebar | 0.24.1 | integrity、依赖声明、Profile 部署与正常启动 |
| @agents-anywhere/dsh-bridge-next | 2.0.2 | integrity、依赖声明、Profile 部署与正常启动 |
| @ychris12138/dsh-usage-stats | 0.3.5 | integrity、依赖声明、Profile 部署与正常启动 |
| dsh-mermaid | 0.4.1 | integrity、依赖声明、Profile 部署与正常启动 |
| dsh-whale-widget | 0.3.18 | integrity、依赖声明、Profile 部署与正常启动 |
| @weibaohui/skills-management | 0.9.0 | integrity、engines.dsh、Profile 部署与正常启动 |
| @dsh-plugins/mcp-panel | 0.1.0 | integrity、依赖声明、Profile 部署与正常启动 |

归档集中另有未默认启用的 `dsh-font` 与五项诊断演练 fixture；不能把归档完整性通过视为它们全部激活通过。以上验证同样不等于逐项执行第三方业务功能（例如 IM 渠道登录或远程连接）。

- 客户端：110 个文件、2,399 项测试通过，覆盖设置、插件管理、团队引导、审批、模型选择、手机布局、提示词和工作区归档恢复。
- 桌面全量：117 个文件通过、1 个文件跳过，838 项测试通过、2 项跳过；外部工具及浏览器回退坐标的 25 项聚焦测试通过。
- NAS：6 个文件、21 项测试通过；新增 Gateway 测试分别验证直接调用、HTTP 与事件流。
- 核心：Loader、插件兼容、子进程、SSH、Codex 和 Profile 事务聚焦回归通过；桌面 Linux 启动适配新增 5 项回归。
- 历史：23 个文件、543 项测试通过，覆盖 v3 迁移、重启恢复、拒绝保护及既有 v0 迁移；没有增加对已知 v0 summary 形态的接受范围。
- 社区构建：8 项构建与类型检查通过，Desktop TypeScript、preload 和欢迎页构建通过。
- 文档：43 项 `doc-sync` 检查通过；新增清单说明同步维护中英文配对。
- 全仓 lint、包依赖规则、workspace constraints、新顶层 await 检查通过。
- 新 revision 18 外部工具清单通过官方 npm 在线校验：两项 alpha.4 Provider、对应运行时及平台依赖的 SHA-512 完整性均通过，旧清单没有修改。
- 新建 macOS arm64 核心闭包与预构建 Profile，通过签名结构、Office 原生 PDF 渲染、目录迁移后的普通 Harness 启动和已认证客户端 HTTP 检查；21,879 项 Profile 资源完成验证。
- Profile 冻结策略与预热缓存下的离线修改通过；冷缓存离线修改没有验收，不宣称任意离线插件编辑都可用。
- 原生 Electron 在新建中文及空格路径完成 Profile 部署，重复部署保持幂等；日志记录 Harness、客户端和事件分发就绪，持续存活至少 15 秒后正常退出。未认证 HTTP 返回 401，隔离 Profile 的已认证 HTTP 在资源烟测中返回成功。
- 真实系统元数据查询与 Loader/OTLP 组合测试通过。沙箱内的 `sysctl`／`ps` 拒绝以原样权限复测区分，不修改断言或关闭检查。

## 限制

不运行 Playwright、`test:web` 或浏览器 replay。Windows、Linux 和另一 macOS 架构没有实机安装验收；没有生成最终安装包，因此这些结果不构成跨平台发布资格。已知 v0 `summary requires notice form` 拒绝保持原状，未修改冻结历史格式或用户源日志。
