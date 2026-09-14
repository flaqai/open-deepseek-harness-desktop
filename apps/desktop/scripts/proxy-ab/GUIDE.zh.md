# pnpm 代理策略 A/B 测试

[English](GUIDE.md) | 中文

## 概要

使用同一套 Node 与 pnpm，比较全局继承 ChatGPT 代理和仅 Codex 继承的策略。测试对象是包下载，不是两个桌面安装包或完整插件激活流程。默认场景使用真实 pnpm 进程和本地 HTTP 服务，故意拒绝经由模拟错误代理的请求。它的成功率变化不代表互联网下载速度提升。

## 目录

- [本机运行](#本机运行)
- [macOS 一键运行](#macos-一键运行)
- [Windows](#windows)
- [真实联网对照](#真实联网对照)
- [阅读报告](#阅读报告)
- [安全与限制](#安全与限制)

## 本机运行

在仓库根目录使用 Node 24.11.1，并确保桌面端的仓库 pnpm 已安装：

```sh
node apps/desktop/scripts/proxy-ab/benchmark.mjs --rounds 10 --output .local-user-errors/releases/v0.1.2-alpha.5/proxy-ab
```

脚本每轮交替执行 before/after。冷缓存尝试使用独立的空 store 和元数据缓存；每次热缓存尝试均有独立、不计时且不注入模拟错误路由的成功预热。预热失败会停止比较，不把空缓存冒充热缓存。可控场景需要 IPv4 映射 IPv6 回环支持；不支持的设备会得到失败或不完整报告，而不是提升结论。

## macOS 一键运行

解压便携 ZIP 后，双击 [run-macos.command](run-macos.command)，并将 [benchmark.mjs](benchmark.mjs) 保留在旁边。启动脚本根据 `/Applications` 或 `~/Applications` 中的应用版本匹配已解压运行时，请事先启动过一次安装版。脚本不下载运行时，也不会选择不相关的缓存版本。默认执行离线隔离场景、十轮及冷/热缓存测试，完成后打开报告文件夹，按回车关闭终端。

报告保存在脚本旁的 `proxy-ab-reports/run-*`。自定义应用位置使用 `--app '/path/Open DeepSeek Harness Desktop.app'`；已解压运行时使用 `--runtime '/path/containing-package-runtime'`。脚本将 `--mode`、`--rounds`、`--cache` 和 `--system-proxy` 传给测试程序。`--output` 指定报告目录；自动执行时可用 `--no-open --no-pause` 禁止打开 Finder 和终端等待。含空格或非 ASCII 字符的路径必须加引号。若 macOS 阻止运行，请检查脚本后使用系统针对单个文件的“打开”操作，不要关闭系统安全保护。

## Windows

将 [benchmark.mjs](benchmark.mjs) 和 [run-windows.ps1](run-windows.ps1) 放在同一文件夹。传入已安装客户端实际使用的 Node 程序和 pnpm 入口，脚本不会猜测安装位置。不需要重新打包、管理员权限或修改 pnpm 源码。原生 Windows 执行仍需由受影响设备的操作者验证；以下示例使用占位路径。

```powershell
.\run-windows.ps1 -NodePath 'C:\path-to-runtime\node.exe' -PnpmPath 'C:\path-to-pnpm\bin\pnpm.mjs' -Rounds 10
```

包装脚本面向 PowerShell 5.1/7。如果本机策略禁止未签名脚本，改用等价 Node 命令并传入 `--node`、`--pnpm`，不要降低系统执行策略。未指定 `-OutputDirectory` 时，报告放入新建的 `proxy-ab-reports/run-*` 目录。

## 真实联网对照

```sh
node apps/desktop/scripts/proxy-ab/benchmark.mjs --mode live --rounds 3 --output .local-user-errors/releases/v0.1.2-alpha.5/proxy-ab
```

联网模式仅从 npm 下载固定公开包 `is-number@7.0.0` 的元数据和归档。这个无依赖探针验证 pnpm 网络链路，不代表 Harness 插件安装。`--system-proxy` 接受被调查的 ChatGPT 代理地址（不含凭据），或 `DIRECT`；Windows 对应 `-Mode live -SystemProxy 'http://proxy-host:port'`。这是显式测试输入，不是自动 PAC 发现。不要猜代理端口。显式继承的代理变量在两组均优先，因此这些环境可能没有路由差异。

不传代理参数时，联网模式是直连策略基线。比较时应保持网络、运行时文件与参数一致，不要同时进行其他下载。三轮只是冒烟测试，不足以给出可靠的性能估计；稳定对比需要增加轮数。

## 阅读报告

每次运行生成 `report.json` 和 `summary.md`，包含 Node/pnpm 版本、pnpm 入口与实现文件 SHA-256、单次耗时、错误码、退出信号、超时与取消标记、已安装清单校验及清理结果。不保存原始子进程输出、代理地址、环境变量值或本地用户路径。控制台会打印本机报告位置。

成功要求进程正常零退出，并且独立读取的已安装清单与目标一致。冷缓存故障场景还要求：失败的 before 尝试确实访问了代理，成功的 after 尝试访问了元数据与归档且未经过代理。缓存安装可能在 pnpm 输出网络警告时仍成功，报告会同时保留这两件事实。

成功率变化使用百分点。速度只比较同轮两组都成功的样本；没有成功配对时显示 `null`/`N/A`，不虚构加速比例。解读前请检查 `completed`、`runnerError`、`fixtureVerified`、`cleanup` 和 `listenersClosed`。场景预期的失败本身不会使测试脚本失败；场景断言不成立、运行器失败或清理失败会返回非零退出码。

## 安全与限制

脚本将 HOME、DSH_HOME、配置、缓存及 store 隔离在新建临时目录中。它忽略用户 `.npmrc`，联网模式仅转发选定的系统、代理与 CA 变量，禁用生命周期脚本及 pnpmfile，不修改安装版 pnpm 或真实 Profile。它不验证私有 registry 凭据、Git 下载、Codex 连通性、PAC 发现或代理认证。联网模式有意不复现用户的全部配置。

每个计时命令最多 20 秒，单次 fetch 超时为 5 秒，关闭重试。Ctrl+C 请求取消后，会等待受管子进程关闭、关闭本地服务、移除临时数据并写入部分报告。强制终止进程或断电可能在系统临时目录留下 `odsh-proxy-ab-*` 文件夹，它不会成为真实 Profile。清理出错时保留本机位置供人工检查。

## 开发备注

策略适配器有意设计为脱离仓库也能分发；after 策略一致性测试会导入当前桌面解析器，以发现源码变动导致的偏差。详见[代理作用范围决策](../../../../.agents/notes/implemented/bug-fix/2026-09-03-desktop-codex-proxy-scope.zh.md)。
