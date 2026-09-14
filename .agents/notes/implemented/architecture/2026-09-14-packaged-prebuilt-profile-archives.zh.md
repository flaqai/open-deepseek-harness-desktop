# Agent Note: 将桌面预构建 Profile 作为校验归档打包

Status: implemented

[English](2026-09-14-packaged-prebuilt-profile-archives.md) | 中文

## Problem

桌面 Release 构建会准备并验证完整的原生 Profile，使首次启动不依赖下载预设插件。若将该 Profile 的依赖树复制到应用资源中，Electron Builder、签名工具、安装程序和产物上传就需要处理数万个小文件。macOS 签名可能在接触真正需要签名的原生文件前耗尽文件描述符，所有平台也都会承担不必要的遍历和元数据开销。

## Decision

每个原生 CI Runner 都会安装精确的启动插件集合，在需要时签名插件原生资源，封装可重定位的 Profile 清单，将其部署到另一个临时路径，运行 Profile 诊断和 Harness 就绪检查，并离线移除一个插件。随后，Runner 将这个已经验证的目录保存为一个未压缩的 `desktop-prebuilt-<platform>-<arch>.tar` 及其独立 SHA-256 文件。Electron Builder 复制该归档、校验文件和数量较少的预设插件归档；它不会复制展开的预构建 Profile。

打包后的 Host 仅在首次启动准备需要时解开预构建归档。它会验证独立摘要，只接受一个符合当前平台的根目录，拒绝绝对路径、父目录穿越、不支持的条目类型、逃逸链接以及超过限制的条目数量和展开体积，并先解压到同级临时目录。Host 在原子发布版本化缓存前验证归档内的 Profile 清单。Profile 部署仍会验证每个封装文件的摘要，并仅重定位受管包元数据，然后再替换活动 Profile。

macOS 和 Linux 还会把生产 Harness 闭包作为未压缩归档携带，并采用同样的摘要、路径、体积、临时解压和版本化缓存规则。Windows 保持 Harness 和 Node 运行时展开，因为已安装的 `dsh.cmd` 命令依赖应用资源中的稳定路径；Windows 只将预构建插件 Profile 打成归档。

## Verification

桌面单元测试覆盖展开运行时兼容、运行时缓存、原生归档根目录选择、摘要失败、安全解压和 Electron Builder 资源映射。原生打包工作流在归档前构建并验证每个平台的预构建 Profile，从最终应用资源中解压并再次部署归档，然后运行目标平台的已安装应用冒烟。macOS 和 Windows 冒烟还会检查最终 DMG、ZIP 或安装程序，而不是接受暂存输出。

## Alternatives considered

**复制展开的 Profile 并提高进程限制。** 未采用，因为签名和打包库可能不受 Shell 限制约束而自行打开文件树，并且展开形式仍会让所有下游工具承担相同的遍历开销。

**恢复为首次启动时从预设 `.tgz` 安装插件。** 未采用，因为它会把包管理器工作重新转移给用户，延长首次启动，并可能在安装包已经通过 Release 验证后失败。

**压缩内部归档。** 未采用，因为 DMG、ZIP、NSIS、DEB 和 RPM 已经会压缩负载。未压缩 tar 避免重复压缩工作，并在保留单个应用资源的同时提供快速顺序解压。

**同时归档 Windows Harness 运行时。** 在已安装命令行包装器仍依赖应用目录内稳定运行时路径时不采用。未来可以先把该包装器迁移到与版本无关的引导程序，再改变 Windows 运行时布局。

## Consequences

Release 构建仍需要花时间在每个原生平台安装并演练全部预设插件，但打包和签名只会看到一个 Profile 归档，而不是完整依赖树。首次启动部署会先进行一次本地解压，再把已验证 Profile 复制到所选数据目录。损坏或不安全的归档会失败，且不会替换有效缓存或活动 Profile。应用在桌面用户数据中保存版本化解压缓存，因此新桌面版本不会信任旧 Release 的模板。
