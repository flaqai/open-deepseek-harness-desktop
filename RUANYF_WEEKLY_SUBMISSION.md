# 《科技爱好者周刊》投稿草稿

Issue 标题：

```text
【开源自荐】Open DeepSeek Harness Desktop：带插件隔离和 IM 机器人的 DSH 桌面发行版
```

Issue 正文：

---

项目地址：https://github.com/flaqai/open-deepseek-harness-desktop

## 项目介绍

Open DeepSeek Harness Desktop 是一个社区维护的 DeepSeek Harness 桌面发行版。它保留官方 Harness 的插件化运行时和 Web 客户端，在外层增加 Electron 本地宿主、桌面打包、首次启动配置和插件生命周期管理。

它不只是把网页放进桌面窗口。客户端会启动并监管本机 Harness 服务，为页面提供受限制的系统集成，并负责普通插件无法介入的启动前检查。项目采用 MIT 许可证，不是 DeepSeek 官方产品，目前处于开发者预览阶段。

## 主要功能

- **完整桌面发行矩阵**：项目面向 macOS Apple Silicon、macOS Intel、Windows x64，以及 Linux DEB、RPM 五种安装包维护统一的打包流程。
- **主题和聊天背景**：内置跟随系统、浅色、深色及八套产品主题，同时提供八张背景插画，也可以上传只保存在本机的 PNG、JPEG 或 WebP 图片。
- **桌面复制支持**：Electron 只向受监管的 Harness 页面开放经过净化的剪贴板写入权限，让消息和代码复制在客户端中正常工作，不开放剪贴板读取权限。
- **开箱即用的插件生态**：安装包预设插件市场、Skill 选择器和 IM 机器人插件。它们都是普通、可卸载的 Harness 插件；用户卸载后，客户端不会在下次启动时自动装回。
- **微信、飞书等机器人连接**：可以在设置中通过扫码、应用清单或现有凭据连接微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord 和 WhatsApp，并切换机器人使用的工作区或绑定已有会话。
- **依赖诊断与插件隔离**：客户端可以检查共享运行时冲突、残留 Loader 条目和插件挂载失败。无法安全修复的插件会退出当前 profile 的活动依赖和启动顺序，并留下可重试、可卸载的隔离记录，让其余功能继续启动。

## 为什么依赖隔离必须由客户端完成

插件系统在功能不断增多后会遇到一个容易被忽略的问题：两个插件可能各自带入不同版本或不同物理副本的共享 Host 包。它们的包名和 API 看起来相同，Node.js 实际加载的却是两套对象。这样会造成服务注册在一套运行时、消费方却在另一套运行时查找，最终表现为插件无法挂载、Loader 条目失管，甚至整个 profile 无法启动。残留的清单项目、锁文件记录和中断安装留下的目录，也可能让下一次更新继续复现同一个错误。

普通诊断插件解决不了这个问题。插件代码只能在依赖解析、配置组合和运行时挂载成功后执行，而上述错误恰好发生在这些步骤之前。故障插件可能阻止诊断插件一起加载；诊断插件也不应该拥有修改其他插件清单、锁文件和启动顺序的权限。因此，这项能力必须放在掌握整个启动过程的客户端启动层。

每次检查时，启动层会遍历 profile 中直接安装插件的依赖图，区分合法的 peer dependency 与真正的共享运行时冲突，并比较关键 Host 包最终解析到的实际位置。它还会核对 profile 清单、锁文件、组合包顺序和磁盘目录，找出已经不属于当前依赖、却仍可能被 Loader 发现的残留项目。设置页提供“立即检查”和“检查并修复”两个入口：前者只读取并展示问题、依赖链和兼容性，后者才会执行受保护的修复操作。

修复会先尝试让插件统一使用桌面安装包提供的共享 Host 依赖，同时清理清单已经删除、锁文件却仍保留的根依赖记录。如果依赖关系能够安全收敛，插件可以继续留在当前 profile；如果插件版本确实不兼容，或者修复后仍存在两个共享运行时实例，客户端就不会带着不确定状态强行启动它。

无法安全修复的根插件会从活动依赖和组合包启动顺序中移出，并写入持久的隔离记录。隔离只针对被确认有问题的插件，不会删除用户的会话、模型配置或其他插件。只有故障插件的活动引用和残留目录已经退出当前 profile，隔离才算完成；如果安装工具在中途崩溃，下一次检查还会根据清单、锁文件、目录和隔离记录之间的差异继续恢复，而不是假装修复成功。

这种处理采用关闭式保护：只要客户端不能确认共享依赖已经统一，就不让故障插件进入当前运行时，但其余健康插件和核心功能仍可继续启动。用户可以在“设置 → 插件 → 诊断”中查看隔离原因，按原安装来源重试插件，或者在明确确认后卸载处于停用状态的残留。这样既避免一个扩展拖垮整个客户端，也保留了恢复插件和排查具体依赖链的机会。

## 界面

| 主题设置 | 聊天背景 |
| --- | --- |
| ![主题设置](https://raw.githubusercontent.com/flaqai/open-deepseek-harness-desktop/master/assets/readme/theme-settings-zh.png) | ![聊天背景](https://raw.githubusercontent.com/flaqai/open-deepseek-harness-desktop/master/assets/readme/background-settings-zh.png) |

## 社区插件

桌面安装包预设并感谢以下开源插件：

- [dsh-im](https://github.com/xmanrui/dsh-im)：微信、飞书等九种 IM 机器人连接。
- [dsh-skill-picker](https://github.com/a735624258/dsh-skill-picker)：在输入区选择并调用 Skill。
- [dsh-market](https://github.com/dsh-market/dsh-market)：在 Harness 内浏览、搜索和管理插件。

项目仓库：https://github.com/flaqai/open-deepseek-harness-desktop

上游 DeepSeek Harness：https://github.com/deepseek-ai/deepseek-harness

<!-- 当前仓库尚无公开 Release。正式投稿前，请先确认 GitHub Releases 中已有至少一个可下载并验证过的安装包，再视情况补充下载链接。 -->
