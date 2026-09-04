# Agent Note：通过 pre-release 撤回更新

状态：已实现

[English](2026-09-04-release-prerelease-withdrawal.md) | 中文

## 问题

旧版桌面更新器在已安装版本带 alpha 或 release-candidate 后缀时，仍会接受 GitHub 中标为 pre-release 的 Release。因此，把有问题的 Release 从 Latest 改为 pre-release 并不能阻止受影响客户端继续发现和下载它。

## 决策

GitHub 的 `prerelease` 字段是应用内更新的无条件发布开关。任何安装渠道都会排除草稿和 pre-release。只有 GitHub Release 未标为 pre-release 时，带语义预发布标签的版本才可以被预发布客户端接受。开始下载前会重新执行更新发现；若 Release 在发现与解析附件之间被改成草稿或 pre-release，标签元数据请求也会拒绝它。

维护者可以通过把有问题的 GitHub Release 改为 pre-release 来撤回应用内更新，同时保留标签和附件。下一次六小时后台刷新或用户手动检查后，该版本会从更新发现中消失；下载操作不会信任过期的可见状态。

## 考虑过的替代方案

GitHub 的 `/releases/latest` 接口也会排除 pre-release，但它只提供一个候选版本，无法在社区和旧版标签前缀之间进行语义版本选择。独立撤回清单可以表达更多状态，但会给二进制安全控制增加另一个托管可用性依赖，而 GitHub 已经提供所需开关。

## 结果

需要通过应用内更新分发的 alpha 或 release-candidate 构建必须发布为普通 GitHub Release，即使标签本身包含语义预发布后缀。特意标为 pre-release 的 GitHub Release 仍可供测试者手动下载，但不会出现在桌面更新器中。
