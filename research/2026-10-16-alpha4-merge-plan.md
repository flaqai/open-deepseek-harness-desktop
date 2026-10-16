# 官方 alpha.4 更新与社区合并冲突规划

## 结论与边界

本报告记录合并前的风险调查：整体风险中等偏高，文本冲突少于上次 alpha.3，但新增市场入口、跨 Host 版本刷新和 Linux 进程生命周期需要行为验证，不能按文件自动合并结果判断安全。调查阶段只读取固定源码并运行无工作区修改的模拟；用户随后批准在独立 worktree 实施，并批准桌面开发版本同步为 `0.2.1-alpha.4`、新增外部工具清单。实施结果另见[集成验收](2026-10-16-alpha4-integration-results.md)。

## 固定来源与社区基线

| 项目 | 固定值 |
| --- | --- |
| 官方目标 | `dsh-v0.2.1-alpha.4` |
| 官方上一版／三方合并基点 | `dsh-v0.2.1-alpha.3` |
| 检查时 master／origin/master | alpha.3 社区集成提交；精确基线见本地 `.artifacts/alpha4-integration-baseline.json` |
| 检查时打包分支 | `fix/windows-packaging-0.2.1-alpha.3` |
| 已发布社区标签 | `odsh-v0.2.1-alpha.3` |
| 官方发布时间 | `2026-10-15T13:40:02Z`，北京时间 10 月 15 日 21:40 |

检查时 master 尚未包含打包分支的三个配套提交：版本与兼容清单、Host aggregate 等待生成的 Typert（修复干净构建竞态）、已完成的发布记录。实施基线已包含这三个提交，并由 `backup/pre-upstream-0.2.1-alpha.4` 保留；不要移动已发布标签。

官方相对 alpha.3 共 89 个提交（其中 64 个非 merge），831 个变化路径，22,232 行增加、2,044 行删除。其中 326 个 manifest 只改变包版本，不能把 831 个路径都解释为实质功能修改。

来源：[官方发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.4)、[固定版本差异](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.1-alpha.3...dsh-v0.2.1-alpha.4)。

## 官方更新：用户可见与未写进摘要的改动

1. 自定义 pi-ai 模型可在界面配置每个模型的推理级别；不是新的全局推理开关，也不是再次修改凭据优先级。
2. 新增可选 Custom plugin markets bundle、Discover 标签和自定义索引读取／生成能力；它没有默认官方市场，不等同于社区预装的第三方 dshmarket。
3. 命令输入改用原子 command chip，涉及编辑器、草稿、撤销和刷新后的恢复，不只是视觉调整。
4. 改进 Office 交付说明，避免引用已经删除的渲染图片和多余 PDF 检查；未发现本次改变 Python／Office 引擎部署策略的必要性。
5. Linux subprocess 缓存 containment 探测并识别 user manager 变化，兼容较旧 systemd；命令结束状态展示、Codex partial_answer 和 Inspector 启动也有修复。
6. 插件兼容优先使用 `engines.dsh`；未声明时仍用既有 DSH peer 规则。错误数据从 `peers` 改为 `requirements`，所有消费者须同步。
7. Host 的版本或 commit 变化时，旧页面暂停应用新的模块图，由用户决定稍后或重新加载页面。稍后不会解除暂停，更不等于同意重启 Harness。
8. 产品事件新增系统版本／架构、CPU 型号与核心数、物理内存等环境元数据；它与会话内容事件上报是不同机制。合并时必须核对社区实际挂载策略和说明，不以“仅匿名性能统计”概括，不顺带改变已有关闭状态。
9. 新增禁止 package 源码顶层 await 的检查、实验包发布依赖规则及 Preview WebWorker 的真实 Profile／懒加载资源支持。

核心来源：[兼容性规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/boot/app-boot/src/plugin-compatibility.ts)、[跨版本刷新控制](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/client/modules/src/client/release-change.ts)、[产品统计字段](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/client/product-analytics/README.md)、[市场组合](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.4/packages/experimental/plugin-market-bundle/cordis.patch.yml)。

## 实际三方模拟结果

分别运行 `git merge-tree --write-tree --name-only -z master dsh-v0.2.1-alpha.4` 和将 `master` 换成当前 `HEAD` 的同一命令。两者均有 52 个冲突路径，集合相同：24 个内容冲突、28 个修改／删除冲突。另有 67 个双方修改但自动合并的路径；共 119 个双方改动的重叠路径需要分类审查。命令退出 1 表示发现冲突，不是构建失败；没有修改 index、工作区或分支。

### 28 个修改／删除冲突

全部是社区已删除、上游继续修改的官方桌面／发布实现，不是 28 个独立核心 API 故障。保留社区壳和 GitHub/CNB 发布流程的删除决定，只提取社区现有调用点确实需要的修复；不能整份恢复官方旧壳。

- `.github/workflows/desktop-publish.yml`
- `.github/workflows/macos-package.yml`
- `.github/workflows/windows-package.yml`
- `apps/desktop-host/src/office.ts`
- `apps/desktop/installer/strings.nsh`
- `apps/desktop/installer/window-frame.cpp`
- `apps/desktop/packaging/README.i18n.yaml`
- `apps/desktop/packaging/README.md`
- `apps/desktop/packaging/README.zh.md`
- `apps/desktop/publishing/ci/README.i18n.yaml`
- `apps/desktop/publishing/ci/README.md`
- `apps/desktop/publishing/ci/README.zh.md`
- `apps/desktop/scripts/desktop-publish-route.ts`
- `apps/desktop/scripts/desktop-release-store.ts`
- `apps/desktop/scripts/installer-directories.nsh`
- `apps/desktop/scripts/installer.nsh`
- `apps/desktop/scripts/publish-desktop-ci.ts`
- `apps/desktop/scripts/resolve-retained-desktop-publish-ci.ts`
- `apps/desktop/scripts/smoke-installer-directories.ps1`
- `apps/desktop/scripts/windows-directory-installer.mjs`
- `apps/desktop/tests/desktop-package-selection.spec.ts`
- `apps/desktop/tests/desktop-publication-preflight.spec.ts`
- `apps/desktop/tests/desktop-publish-route.spec.ts`
- `apps/desktop/tests/desktop-release-store.spec.ts`
- `apps/desktop/tests/expected/windows-installer.json`
- `apps/desktop/tests/fixtures/installer-directory-smoke.nsi`
- `apps/desktop/tests/windows-installer-extract-report.cpp`
- `apps/desktop/tests/windows-installer-smoke.ps1`

Windows 安装目录替换失败、原始错误码、恢复结果和备份路径的报告改进可以按社区 NSIS 的真实流程移植，但要单独验证。官方新增的 `directory-report.h` 等文件即使没有冲突，也应检查是否仅属已删除安装器的依赖，避免留下无人使用的源码和测试。

### 24 个内容冲突与处理规则

| 组别 | 路径 | 推荐处理 |
| --- | --- | --- |
| 插件页面 4 项 | `ui-plugin-manager` 的 `PluginManagerPage.tsx`、`index.ts`、`slot-contract.ts`、`tests/components.client.spec.tsx` | 保留社区团队首次高亮、“去使用”、关联插件启停、`plugins.bundle.action`；加入上游 `plugins.tab`、Discover、安装状态与导航生命周期 |
| 设置 3 项 | `ui-settings-general` 的 `src/client/index.ts`、`tests/apply.client.spec.ts`、`tests/shell.client.spec.ts` | 加入 HostReleasePrompt 和 modules 依赖，保留社区设置顺序、日志／配置按钮、关于更新入口和手机分层导航 |
| 子进程 3 项 | `subprocess-local` 的 `src/index.ts`、`README.md`、`README.i18n.yaml` | 同时保留社区显式授权的 persistent service 生命周期和上游 Linux scope 重新探测；不能二选一丢弃其中一段方法 |
| manifest 3 项 | `package.json`、`apps/desktop/package.json`、`packages/experimental/client-ui-agent-team/package.json` | 核心统一 alpha.4，社区发行版本保持当前已发布 alpha.3，除非用户另行指定；按新实验包依赖政策核对社区附加 imports |
| 构建政策 3 项 | `scripts/check-workspace-constraints.ts`、`scripts/package-dependency-policy.ts`、`tsconfig.host.json` | 加入新市场包、私有生成工具、Worker 文件规则，保留社区桌面、资源选择及原生 smoke 的约束，不放宽门禁 |
| CLI 测试 1 项 | `apps/cli/tests/plugin.spec.ts` | 更新 requirements 错误语义，同时保留社区普通 CLI、修改锁、快照和不隐式委托激活的回归 |
| slot 目录 1 项 | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` | 按最终注册结果重建／核对，不任选旧版目录 |
| 文档与生成 6 项 | `apps/cli/README.i18n.yaml`、`docs/module-graph.{md,zh.md}`、`docs/user/develop/basic/publish.{md,zh.md,i18n.yaml}` | 保留社区实际入口与发布边界，更新成对说明，生成图按最终源码重建 |

## 自动合并也必须复核的风险

- **NAS 三级权限**：新 `pluginMarket/listIndexes`、`search`、`setIndexes` 和 `plugin-market/changed` 不能盲目加入非管理员允许清单。推荐先保持管理员独有，其他角色显示明确权限提示；HTTP、WS、事件、安装与设置写入同时检查。
- **重启与刷新**：新提示仅刷新页面，不创建 Supervisor 停止／激活请求。验证市场未确认时 Harness PID 不变、确认后单服务、退出取消、候选回滚及旧页面暂停新模块。
- **模型与草稿**：`ProviderEditor.tsx`、`ModelsSection.tsx`、模型 store、InputBar CSS 和测试有自动重叠。保留搜索、移动端布局、旧草稿、引用／附件和未识别配置；异步命令恢复只解析，不能执行。
- **插件事务**：新官方索引安装经 plugin-manager 的确认流程，逐项核查是否属于桌面候选授权范围；第三方 dshmarket 继续普通 CLI＋锁＋快照，不重新继承候选事务变量。
- **构建和资源闭包**：`pnpm-lock.yaml` 自动合并不表示最终可用。manifest 完成后固定 pnpm 重建，并核对新市场解析 Worker、远程事件声明、客户端 chunks 及 Profile 指纹；保留 alpha.3 的 Typert 顺序修复。
- **进程与退出码**：`linux-scope.ts` 自动合并后须复核 provider 缓存、user manager 代次变化与失败重探测；命令 badge 不把无退出码当 0，也不把所有非零退出说成工具链损坏。
- **统计元数据**：首次启用采样有超时、取消和一次性缓存，Windows PowerShell 查询不能闪控制台或阻塞就绪；关闭时不得启动新采样。按实际策略说明硬件字段和接收端，不与会话上报合并成一个模糊开关。

### 预装插件的声明检查

只读提取已发布 alpha.3 Windows run `38721827443` 的九项 startup `.tgz` 中的 manifest，并按 alpha.4 的 `includePrerelease` 规则检查。九项均未见声明层面的版本拒绝；只有 `@weibaohui/skills-management@0.9.1` 声明 `engines.dsh >=0.1.7-rc.2`，其余沿用 peer 或无 DSH 版本声明。

这不等于安装或激活已通过。实施时必须以锁定的实际归档验证安装、Host／Client 挂载与主要入口，不因 peer 较旧直接删除，也不通过第三方源码补丁隐藏不兼容。若后续更新插件版本，应重做本表，不能沿用旧归档检查结论。

## 推荐实施顺序与验收

1. 审核并整理上述三个 alpha.3 配套提交到社区基线；固定完整 SHA、备份引用，再创建独立 `merge/upstream-0.2.1-alpha.4` 工作树。不得携带无关未提交修改，基线移动后重新模拟台账。
2. 先处理 manifest、包图、依赖政策、生成类型与 Worker 入口，再接入 compatibility 的 `requirements` 数据迁移；保留当前发行版本与已发布标签。
3. 整合 Linux subprocess、SSH 与命令结束状态；独立验证 persistent service 授权、撤销、退出及目录切换清理。
4. 接入新官方市场与 Host 刷新提示：保留 dshmarket，新实验 bundle 维持默认关闭；NAS 管理接口保持管理员独有。验证市场锁／事务／重启、源配置与安装取消。
5. 整组迁移 command chip 和模型 reasoning 编辑器；同步社区团队引导、手机布局、归档、审批语言与文件打开／定位。
6. 处理预装资源、社区 NSIS 对应的安装错误报告，再重建 Profile、资源清单和生成文档；锁文件在 manifest 收敛后生成。
7. 运行聚焦行为测试、Host／Client／Desktop 类型检查、lint、依赖政策和文档门禁；社区构建后，在隔离配置及中文／空格路径验证启动、离线部署、市场确认重启和回滚。
8. Windows 原生检查覆盖目录锁、权限拒绝、替换恢复失败、静默退出码；Linux 真机覆盖 systemd 代次、取消和进程清理。缺少环境时列未验证，不能以 macOS 通过代替。禁止默认运行 Playwright、`test:web` 或浏览器 replay。

具体回归：三角色直接 RPC／HTTP／WS；旧版无 command 字段草稿；chip 删除、撤销、刷新恢复与并发编辑；reasoning off／级别转换、模型重排和未知配置；新旧市场共存；页面“稍后”不自动刷新／重启；同版本同 commit 的插件热更新；跨 commit 更新后的手动页面刷新；核心失败仍能进入社区恢复界面。

本次未发现 v0→v1 迁移器源码或会话格式状态的更新，已知 `summary requires notice form` 不应宣称随 alpha.4 修复。默认计划沿用现有 Python／Office 部署、社区壳、NAS 三级权限与市场确认重启；若要默认启用官方新市场或改变统计采集政策，应作为独立产品决策确认。

## 证据限制

本报告是固定源码与模拟合并结果，不是实施完成或可发布声明。没有验证新插件安装、真实 NAS 部署、三平台运行或新安装包；未创建 alpha.4 工作树、合并提交、标签或 Release。

接口与运行时细节见[运行时风险调查](2026-10-16-alpha4-runtime-risks.md)。
