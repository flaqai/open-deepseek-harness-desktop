# Desktop Release identity and notes

Use this reference whenever preparing notes or publishing a desktop Release. Fill every field from repository and package evidence; do not return an empty template for the user to complete.

## Derive the identity

Read the version from `apps/desktop/package.json` in the final release worktree and require it to match the verified `<primary-checkout>/release/<version>/` directory.

```text
tag: odsh-v<version>
title: v<version>
body heading: # Open DeepSeek Harness Desktop v<version>
notes path: .artifacts/release-notes/odsh-v<version>.md
```

Recent community Releases use the `odsh-v` tag namespace and the compact `v<version>` GitHub title. Preserve these values unless the user explicitly chooses another identity. Before review, confirm that the tag does not collide on GitHub or CNB and that the tag target will be the final source SHA.

Release state is a separate reviewed field. An `alpha`, `beta`, or `rc` version may still be a normal GitHub Release when the user intends it to be the current public in-app update. Marking it as a GitHub prerelease withdraws it from normal client discovery and makes it ineligible for the current CNB mirror.

## Establish the release delta

Select the previous published, non-draft Release that was eligible for normal client updates; do not compare only with an upstream tag or an earlier build attempt of the same version. Collect:

- commits and changed files from the previous Release tag to the final source SHA;
- merged upstream tag and upstream notes, when an upstream synchronization is present;
- issue fixes supported by commits, tests, or retained incident evidence;
- bundled plugin snapshot versions from the accepted package workflows compared with the previous published snapshot;
- platform qualification actually completed for the seven installers;
- confirmed upgrade limitations, unsigned-package instructions, data migration boundaries, and known issues.

Group commits by user-visible outcome. Omit refactors, test-only work, generated-file churn, reverted changes, and implementation details unless they materially affect compatibility or recovery. Do not infer a fix from an issue title alone.

## Fill the bilingual body

Use this order, omitting a conditional section only when it has no supported content:

```markdown
# Open DeepSeek Harness Desktop v<version>

Open DeepSeek Harness Desktop 是由 FLAQ AI 独立维护的社区桌面发行版，基于开源 DeepSeek Harness 构建，**并非 DeepSeek 官方产品**。

Open DeepSeek Harness Desktop is an independently maintained community desktop distribution by FLAQ AI, built on the open-source DeepSeek Harness. **It is not an official DeepSeek product.**

<one concise Chinese release summary>

<matching English release summary>

## 中文

### <按用户结果命名的更新主题>

- <有证据的用户可见变化>

### 预置插件更新

- `<package>`：`<old>` → `<new>`

### 升级与兼容性提醒

- <only confirmed migration, backup, plugin, session, or signing guidance>

### 下载与校验

- Windows x64: `DeepSeek-Harness-windows-x64.exe`
- macOS Apple Silicon: `DeepSeek-Harness-macos-arm64.dmg` or `.zip`
- macOS Intel: `DeepSeek-Harness-macos-x64.dmg` or `.zip`
- Linux Debian/Ubuntu: `DeepSeek-Harness-linux-x64.deb`
- Linux Fedora/RHEL: `DeepSeek-Harness-linux-x64.rpm`
- 使用 `SHA256SUMS` 校验下载文件。

### 安装提示

<only current, platform-specific installation facts>

### 反馈

<request OS/version, installer filename, reproduction steps, logs, diagnostics, and screenshots>

## English

### <matching update theme>

- <complete translation of the Chinese claim>

### Bundled Plugin Updates

- `<package>`: `<old>` → `<new>`

### Upgrade and Compatibility Notes

- <matching guidance>

### Downloads and Verification

<same seven installer choices and SHA256SUMS guidance>

### Installation Notes

<matching platform facts>

### Feedback

<matching diagnostic request>

Project repository: [flaqai/open-deepseek-harness-desktop](https://github.com/flaqai/open-deepseek-harness-desktop)

Upstream project: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
```

Choose two to six update themes that describe user outcomes, such as startup and recovery, plugin diagnostics, desktop workflow, sessions and models, or upstream synchronization. Keep the Chinese and English sections in the same order with the same facts, versions, warnings, and omissions. Translate meaning rather than sentence fragments; neither language is a summary of the other.

## Apply lessons from recent Releases

- Produce one coherent final document. Do not preserve upload diaries, numbered retry notes, `原部分`, emergency headings, or statements such as “third upload” and “please reinstall” that describe the maintainer's publishing process rather than the software.
- Describe the delta once. Do not paste the previous Release body beneath new changes or repeat an older feature merely because it remains available.
- Put urgent confirmed warnings in a concise blockquote after the summaries or in the compatibility section. Do not turn a temporary diagnosis, speculation, or future promise into a heading.
- State the upstream baseline exactly when it changed. Separate upstream changes from community desktop changes without implying that FLAQ authored upstream work.
- List bundled plugin versions only from accepted workflow snapshots. Do not say “latest” or copy registry state observed outside the package run.
- Include only installers present in the verified local exact set. Do not claim signing, notarization, architecture support, startup health, or a bug fix beyond completed evidence.
- Keep known issues actionable and current. Remove resolved issues and do not use the section as a backlog.
- The GitHub and CNB Release body is the same bilingual document. Do not prepare a shortened CNB copy whose claims could drift.

## Review the filled result

Before requesting publication authorization, verify:

- version, tag, title, heading, notes filename, release directory, and source SHA agree;
- every material claim maps to the selected commit range, accepted plugin snapshot, test, or platform run;
- Chinese and English headings and bullets have one-to-one semantic coverage;
- installer names are exact and `SHA256SUMS` belongs to the same seven files;
- warnings match the reviewed GitHub Release state and CNB eligibility;
- Markdown links resolve and no credentials, local usernames, private paths, raw logs, or temporary signed URLs appear.
