# Agent Note: 项目级 iOS 开发 skill 包

Status: implemented

[English](2026-08-19-project-ios-development-skills.md) | 中文

## Problem

Harness 从当前 checkout 发现 skill（技能）时，贡献者需要使用相同的 iOS 发布、Simulator、性能、内存、App Intents、ASO 和 SwiftUI 工作流。用户级 Codex 安装不会随仓库分发，而把源仓库安装为 Codex 插件会引入 Harness 项目 skill loader 不负责的产品专用插件和 MCP 配置。

## Decision

本仓库把 [`flaqai/ios-application-development-skills`](https://github.com/flaqai/ios-application-development-skills) commit `584f40558fce67833a36eb0cfbfdc915ef541af4` 中的 11 个 skill 目录直接保存到 `.agents/skills/`。每个目录都保留该快照中的 `SKILL.md`、agent 元数据、参考资料、脚本、模板、测试和 eval。Harness 通过现有的 project-agents skill 根目录发现这些目录，因此当前 checkout 无需修改用户的全局 skill 安装即可使用这些工作流。

源仓库的 Codex 市场 manifest、顶层 agent 元数据和 `.mcp.json` 不会复制。需要 XcodeBuildMCP 的 skill 仍会明确该前置条件，并且必须使用当前环境提供的 MCP 服务；安装项目 skill 不会静默添加或启动该服务。

## Alternatives considered

**仅把 skill 安装到用户的 Codex 主目录。** 否决，因为其他 checkout 和贡献者无法获得这些工作流，而且仓库行为会依赖未跟踪的用户状态。

**把完整源仓库安装为 Codex 市场插件。** 否决，因为 DeepSeek Harness 消费项目 skill 目录而不是 Codex 市场 manifest，并且引入 `.mcp.json` 会把 skill 分发与工具服务配置混在一起。

**通过 Git submodule 或符号链接引用源仓库。** 否决，因为 skill 发现必须在普通 checkout 中直接工作，不能要求第二个初始化步骤或依赖仓库之外的文件系统目标。

## Consequences

当前 checkout 包含 11 个工作流及其支持文件的可评审快照。更新该 skill 包时，必须选择新的源 commit、整体替换所有受影响目录、验证上游 skill 包，并检查已安装目录与所选快照一致。复制的 skill 会增加仓库体积，并且在显式更新前可能与上游产生差异。当前环境未提供兼容的 XcodeBuildMCP 工具时，Simulator 工作流仍不可用。

## Verification

上游 `validate_bundle.py` 检查会验证市场链接、全部 11 个 skill 条目、eval、MCP 元数据和已跟踪的上游 hash。递归比较确认每个已安装项目目录都与记录 commit 中的源目录按字节一致。仓库的 `verify-skill-invocation-metadata` 检查会验证跨产品调用策略元数据。
