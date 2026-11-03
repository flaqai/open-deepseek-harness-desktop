---
kind: upgrade-guide
description: "fs-observation-policy 行随发行版禁用，write、edit 与 apply_patch 不再要求先读，apply_patch 仍需显式启用。"
---

# 文件系统修改默认不再要求先读

[English](guide.md) | 中文

## 变更

在 0.2.2-alpha.2 中，`dsh-base` 挂载了 `@deepseek-ai/dsh-fs-observation-policy`，因此所有叠加 base 的 profile 中，`write` 拒绝覆盖模型未读过的文件，`edit` 拒绝未读或被外部修改的文件，模型提示语也点名该策略。现在 `fs-observation-policy` 行以 `disabled: true` 交付：`write` 直接覆盖，`edit` 直接替换字面文本，新增的 `apply_patch` 只凭上下文匹配应用 hunk，三者均无条件执行。`write` 与 `edit` 的提示语仍要求先读，但不再引用该策略。Review 采集、沙箱围栏与 `fs/observed` 事件不变。

随发行版交付的 `tool-fs` 行保持 `applyPatch: false`。启用 `apply_patch` 是独立的显式选择；关闭观察策略不会启用该工具。

受影响范围：叠加 base 的 profile（`headless`、`web`、`sdk`、`acp`；`sdk-minimal` 不叠加 `dsh-base`，从未挂载该策略，文本工具保持关闭），按 id 覆盖 `fs-observation-policy` 或 `tool-fs` 行的 profile patch，以及包含 `FS_NOT_OBSERVED` 或 `FS_STALE_VERSION` 拒绝的录制期望。

## 迁移

1. 要保留先读后写行为，在 profile 的 `cordis.patch.yml`（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）中加入：

   ```yaml
   - id: fs-observation-policy
     disabled: false
   ```

   已带有该行且 `disabled: false` 的 profile patch 无需改动；为退出策略而写 `disabled: true` 的可以删掉该覆盖。
2. 已有显式 `fs-observation-policy` 与 `tool-fs.applyPatch` 覆盖保持原值。要启用 `apply_patch`，在所属 `tool-fs` 行设置 `applyPatch: true`；发行默认值仍为 `false`。
3. 用 `dsh --profile <profile> --dump-config` 确认：`fs-observation-policy` 行显示预期的 `disabled` 值，`tool-fs` 行显示预期的 `applyPatch` 值。在会话中，行禁用时对未读文件执行 `edit` 成功，启用时以 `FS_NOT_OBSERVED` 失败。
