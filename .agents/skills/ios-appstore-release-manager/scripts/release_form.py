#!/usr/bin/env python3
"""Create, validate, and summarize App Store Connect Markdown release forms."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path


LEGACY_LOCALE_IDS = (
    "en-US",
    "ja",
    "es-ES",
    "pt-BR",
    "fr-FR",
    "zh-Hans",
    "zh-Hant",
    "de-DE",
    "ko",
    "ru",
    "th",
    "vi",
)
ALL_LOCALES = (
    ("en-US", "英语（美国）", "localized_primary"),
    ("ar-SA", "阿拉伯语", "localized"),
    ("hi", "北印度语", "localized"),
    ("pl", "波兰语", "localized"),
    ("da", "丹麦语", "localized"),
    ("de-DE", "德语", "localized"),
    ("ru", "俄语", "localized"),
    ("fr-FR", "法语", "localized"),
    ("fr-CA", "法语（加拿大）", "localized"),
    ("zh-Hant", "繁体中文", "localized"),
    ("fi", "芬兰语", "localized"),
    ("ko", "韩语", "localized"),
    ("nl-NL", "荷兰语", "localized"),
    ("ca", "加泰罗尼亚语", "localized"),
    ("zh-Hans", "简体中文", "localized"),
    ("cs", "捷克语", "localized"),
    ("hr", "克罗地亚语", "localized"),
    ("ro", "罗马尼亚语", "localized"),
    ("ms", "马来语", "localized"),
    ("no", "挪威语", "localized"),
    ("pt-BR", "葡萄牙语（巴西）", "localized"),
    ("pt-PT", "葡萄牙语（葡萄牙）", "localized"),
    ("ja", "日语", "localized"),
    ("sv", "瑞典语", "localized"),
    ("sk", "斯洛伐克语", "localized"),
    ("th", "泰语", "localized"),
    ("tr", "土耳其语", "localized"),
    ("uk", "乌克兰语", "localized"),
    ("es-MX", "西班牙语（墨西哥）", "localized"),
    ("es-ES", "西班牙语（西班牙）", "localized"),
    ("he", "希伯来语", "localized"),
    ("el", "希腊语", "localized"),
    ("hu", "匈牙利语", "localized"),
    ("it", "意大利语", "localized"),
    ("id", "印度尼西亚语", "localized"),
    ("en-AU", "英语（澳大利亚）", "localized"),
    ("en-CA", "英语（加拿大）", "localized"),
    ("en-GB", "英语（英国）", "localized"),
    ("vi", "越南语", "localized"),
    ("or", "奥里亚语", "unlocalized_add_required"),
    ("gu", "古吉拉特语", "unlocalized_add_required"),
    ("kn", "坎纳达语", "unlocalized_add_required"),
    ("mr", "马拉地语", "unlocalized_add_required"),
    ("ml", "马拉雅拉姆语", "unlocalized_add_required"),
    ("bn", "孟加拉语", "unlocalized_add_required"),
    ("pa", "旁遮普语", "unlocalized_add_required"),
    ("sl", "斯洛文尼亚语", "unlocalized_add_required"),
    ("te", "泰卢固语", "unlocalized_add_required"),
    ("ta", "泰米尔语", "unlocalized_add_required"),
    ("ur", "乌尔都语", "unlocalized_add_required"),
)
ALL_LOCALE_IDS = tuple(locale for locale, _, _ in ALL_LOCALES)
ALL_LOCALE_INVENTORY = ",".join(ALL_LOCALE_IDS)
LOCALE_LABELS = {locale: label for locale, label, _ in ALL_LOCALES}
PLACEHOLDERS = {
    "VERSION",
    "BUILD",
    "PREVIOUS_VERSION",
    "SOURCE_COMMIT",
    "TODO_ZH_PROMOTIONAL_TEXT",
    "TODO_ZH_DESCRIPTION",
    "TODO_ZH_KEYWORDS",
    "TODO_ZH_WHATS_NEW",
    "TODO_AFTER_ZH_APPROVAL",
    "TODO_NEW_LOCALE_DESCRIPTION_AFTER_ZH_APPROVAL",
    "TODO_ZH_STABLE_DESCRIPTION_FOR_NEW_LOCALES",
    "TODO_SOURCE_DESCRIPTION",
    "TODO_SOURCE_PROMOTIONAL_TEXT",
    "TODO_SOURCE_KEYWORDS",
    "TODO_SOURCE_WHATS_NEW",
    "TODO_AFTER_SOURCE_APPROVAL",
    "TODO_AFTER_SCOPE_CHOICE",
    "TODO_REVIEW_NOTES_WITHOUT_CREDENTIALS",
}
LIMITS = {
    "推广文本": 170,
    "此版本的新增内容": 4000,
    "描述": 4000,
    "关键词": 100,
}
PUBLIC_COPY_FIELDS = ("描述", "推广文本", "关键词", "此版本的新增内容")
PAGE_STRATEGIES = {
    "pending_page_comparison",
    "not_in_scope",
    "use_translation_page_was_empty",
    "matches_translation",
    "replace_after_user_confirmation",
    "inherit_after_user_confirmation",
}
LOCALIZATION_SCOPES = {
    "pending_user_choice",
    "app_store_connect_localized_languages",
    "app_store_connect_all_languages",
}
UNLOCALIZED_LOCALE_POLICIES = {
    "pending_user_choice",
    "exclude_after_user_confirmation",
    "include_after_user_confirmation",
}
COMPUTER_USE_AVAILABILITY = {
    "pending_check",
    "available",
    "unavailable_fallback_browser",
    "unavailable_blocked",
}
APPLE_VERSION_RE = re.compile(r"^[0-9]+(?:\.[0-9]+){0,2}$")


@dataclass
class Result:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def emit(self, path: Path) -> int:
        print(f"{path}:")
        for item in self.errors:
            print(f"  ERROR: {item}")
        for item in self.warnings:
            print(f"  WARN: {item}")
        if not self.errors and not self.warnings:
            print("  OK")
        return 1 if self.errors else 0


@dataclass(frozen=True)
class ProjectVersion:
    version: str
    build: str
    project_type: str
    version_source: str
    xcode_container: str = "none"
    xcode_scheme: str = "none"
    xcode_configuration: str = "Release"


def read_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    if not match:
        return {}
    result: dict[str, str] = {}
    for raw in match.group(1).splitlines():
        if ":" not in raw:
            continue
        key, value = raw.split(":", 1)
        result[key.strip()] = value.strip().strip("\"'")
    return result


def release_dir(repo: Path) -> Path:
    return repo / "docs" / "app-store-connect" / "releases"


def read_pubspec_version(repo: Path) -> tuple[str, str]:
    text = (repo / "pubspec.yaml").read_text(encoding="utf-8")
    match = re.search(
        r"(?m)^version:\s*(?P<quote>['\"]?)"
        r"(?P<version>[0-9]+(?:\.[0-9]+){0,2})\+"
        r"(?P<build>[0-9]+(?:\.[0-9]+){0,2})"
        r"(?P=quote)\s*(?:#.*)?$",
        text,
    )
    if not match:
        raise ValueError("pubspec.yaml does not contain version: <version>+<build>")
    return match.group("version"), match.group("build")


def validate_version_identifiers(version: str, build: str) -> None:
    if APPLE_VERSION_RE.fullmatch(version) is None:
        raise ValueError(
            "version must contain one to three dot-separated non-negative integers"
        )
    if APPLE_VERSION_RE.fullmatch(build) is None:
        raise ValueError(
            "build must contain one to three dot-separated non-negative integers"
        )


def _repo_relative(repo: Path, value: str) -> Path:
    path = Path(value).expanduser()
    path = path if path.is_absolute() else repo / path
    resolved = path.resolve()
    try:
        resolved.relative_to(repo)
    except ValueError as error:
        raise ValueError(f"Xcode container must be inside repository: {value}") from error
    if not resolved.exists():
        raise ValueError(f"Xcode container does not exist: {value}")
    return resolved


def _xcode_candidates(repo: Path, suffix: str) -> list[Path]:
    excluded = {"build", "Pods", "DerivedData", ".swiftpm", ".git"}
    candidates: list[Path] = []
    for path in repo.rglob(f"*{suffix}"):
        parts = path.relative_to(repo).parts
        if any(part in excluded for part in parts):
            continue
        if any(
            parent.endswith((".xcodeproj", ".xcworkspace"))
            for parent in parts[:-1]
        ):
            continue
        candidates.append(path)
    return sorted(candidates)


def _run_xcode_json(command: list[str], repo: Path) -> object:
    try:
        completed = subprocess.run(
            command,
            cwd=repo,
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as error:
        raise ValueError(f"unable to run xcodebuild: {error}") from error
    if completed.returncode:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise ValueError(f"xcodebuild failed: {detail}")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise ValueError("xcodebuild returned invalid JSON") from error


def resolve_xcode_container(
    repo: Path,
    workspace: str | None,
    project: str | None,
) -> tuple[str, Path]:
    if workspace and project:
        raise ValueError("--workspace and --project cannot be used together")
    if workspace:
        path = _repo_relative(repo, workspace)
        if path.suffix != ".xcworkspace":
            raise ValueError("--workspace must point to a .xcworkspace")
        return "workspace", path
    if project:
        path = _repo_relative(repo, project)
        if path.suffix != ".xcodeproj":
            raise ValueError("--project must point to a .xcodeproj")
        return "project", path

    workspaces = _xcode_candidates(repo, ".xcworkspace")
    if len(workspaces) == 1:
        return "workspace", workspaces[0]
    if len(workspaces) > 1:
        raise ValueError("multiple Xcode workspaces found; pass --workspace")
    projects = _xcode_candidates(repo, ".xcodeproj")
    if len(projects) == 1:
        return "project", projects[0]
    if len(projects) > 1:
        raise ValueError("multiple Xcode projects found; pass --project")
    raise ValueError("no Flutter pubspec.yaml or Xcode workspace/project found")


def resolve_xcode_scheme(
    repo: Path,
    container_kind: str,
    container: Path,
    scheme: str | None,
) -> str:
    flag = "-workspace" if container_kind == "workspace" else "-project"
    data = _run_xcode_json(
        ["xcodebuild", "-list", "-json", flag, str(container)], repo
    )
    root = data.get(container_kind, {}) if isinstance(data, dict) else {}
    schemes = root.get("schemes", []) if isinstance(root, dict) else []
    available = [value for value in schemes if isinstance(value, str)]
    if scheme:
        if scheme not in available:
            if not available:
                raise ValueError(
                    "xcodebuild reported no shared schemes; cannot verify --scheme"
                )
            raise ValueError(
                f"scheme {scheme!r} not found; available schemes: {', '.join(available)}"
            )
        return scheme
    if len(available) == 1:
        return available[0]
    if len(available) > 1:
        raise ValueError("multiple Xcode schemes found; pass --scheme")
    raise ValueError("no shared Xcode scheme found; pass --scheme")


def read_xcode_version(
    repo: Path,
    container_kind: str,
    container: Path,
    scheme: str,
    configuration: str,
) -> tuple[str, str]:
    flag = "-workspace" if container_kind == "workspace" else "-project"
    data = _run_xcode_json(
        [
            "xcodebuild",
            "-showBuildSettings",
            "-json",
            flag,
            str(container),
            "-scheme",
            scheme,
            "-configuration",
            configuration,
        ],
        repo,
    )
    if not isinstance(data, list):
        raise ValueError("xcodebuild build settings JSON must be an array")
    settings = [
        item.get("buildSettings", {})
        for item in data
        if isinstance(item, dict) and isinstance(item.get("buildSettings"), dict)
    ]
    app_settings = [
        item
        for item in settings
        if item.get("PRODUCT_TYPE") == "com.apple.product-type.application"
    ]
    selected = app_settings or settings
    pairs = {
        (str(item["MARKETING_VERSION"]), str(item["CURRENT_PROJECT_VERSION"]))
        for item in selected
        if item.get("MARKETING_VERSION") is not None
        and item.get("CURRENT_PROJECT_VERSION") is not None
    }
    if len(pairs) != 1:
        raise ValueError(
            "unable to identify one MARKETING_VERSION/CURRENT_PROJECT_VERSION pair "
            "for the selected app target"
        )
    return next(iter(pairs))


def resolve_project_version(repo: Path, args: argparse.Namespace) -> ProjectVersion:
    version = getattr(args, "version", None)
    build = getattr(args, "build", None)
    if bool(version) != bool(build):
        raise ValueError("--version and --build must be provided together")

    requested_type = getattr(args, "project_type", "auto")
    configuration = getattr(args, "configuration", "Release")
    workspace = getattr(args, "workspace", None)
    project = getattr(args, "project", None)
    scheme_arg = getattr(args, "scheme", None)

    if version:
        validate_version_identifiers(version, build)
        if requested_type == "flutter" or (
            requested_type == "auto" and (repo / "pubspec.yaml").exists()
        ):
            return ProjectVersion(
                version,
                build,
                "flutter",
                "explicit",
                xcode_configuration=configuration,
            )
        if requested_type == "auto":
            try:
                container_kind, container = resolve_xcode_container(
                    repo, workspace, project
                )
            except ValueError as error:
                if str(error) == "no Flutter pubspec.yaml or Xcode workspace/project found":
                    return ProjectVersion(
                        version,
                        build,
                        "unknown",
                        "explicit",
                        xcode_configuration=configuration,
                    )
                raise
        else:
            container_kind, container = resolve_xcode_container(
                repo, workspace, project
            )
        scheme = resolve_xcode_scheme(repo, container_kind, container, scheme_arg)
        return ProjectVersion(
            version,
            build,
            "xcode",
            "explicit",
            str(container.relative_to(repo)),
            scheme,
            configuration,
        )

    if requested_type in {"auto", "flutter"} and (repo / "pubspec.yaml").exists():
        detected_version, detected_build = read_pubspec_version(repo)
        validate_version_identifiers(detected_version, detected_build)
        return ProjectVersion(
            detected_version,
            detected_build,
            "flutter",
            "pubspec.yaml",
            xcode_configuration=configuration,
        )
    if requested_type == "flutter":
        raise ValueError("--project-type flutter requires pubspec.yaml")

    container_kind, container = resolve_xcode_container(repo, workspace, project)
    scheme = resolve_xcode_scheme(repo, container_kind, container, scheme_arg)
    detected_version, detected_build = read_xcode_version(
        repo, container_kind, container, scheme, configuration
    )
    validate_version_identifiers(detected_version, detected_build)
    return ProjectVersion(
        detected_version,
        detected_build,
        "xcode",
        "xcodebuild",
        str(container.relative_to(repo)),
        scheme,
        configuration,
    )


def version_key(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value))


def previous_release(repo: Path, current: str) -> str:
    candidates = []
    for path in release_dir(repo).glob("*.md"):
        if path.name.startswith(("_", "index")):
            continue
        meta = read_frontmatter(path.read_text(encoding="utf-8"))
        version = meta.get("app_version", path.stem)
        if version_key(version) < version_key(current):
            candidates.append(version)
    return max(candidates, key=version_key) if candidates else "not_recorded"


def source_commit(repo: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=repo,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "not_recorded"


def locale_sections(source_locale: str = "zh-Hans") -> str:
    sections = []
    for locale, label, asc_state in ALL_LOCALES:
        is_unlocalized = asc_state == "unlocalized_add_required"
        if locale == source_locale:
            status = "pending_source_approval"
            page_strategy = "pending_page_comparison"
            placeholder = "`TODO_AFTER_SOURCE_APPROVAL`"
        elif is_unlocalized:
            status = "pending_scope_choice"
            page_strategy = "not_in_scope"
            placeholder = "`TODO_AFTER_SCOPE_CHOICE`"
        else:
            status = "pending_translation_after_source_approval"
            page_strategy = "pending_page_comparison"
            placeholder = "`TODO_AFTER_SOURCE_APPROVAL`"
        sections.append(
            f"<!-- locale:{locale} -->\n"
            f"### {locale} — {label}\n\n"
            f"- App Store Connect 清单状态：`{asc_state}`\n"
            f"- 状态：`{status}`\n"
            f"- 描述页面策略：`{page_strategy}`\n"
            f"- 描述：{placeholder}\n"
            f"- 推广文本页面策略：`{page_strategy}`\n"
            f"- 推广文本：{placeholder}\n"
            f"- 关键词页面策略：`{page_strategy}`\n"
            f"- 关键词：{placeholder}\n"
            f"- 此版本的新增内容页面策略：`{page_strategy}`\n"
            f"- 此版本的新增内容：{placeholder}\n"
        )
    return "\n".join(sections)


def render_new(
    version: str,
    build: str,
    previous: str,
    commit: str,
    source_locale: str = "zh-Hans",
    project_type: str = "flutter",
    version_source: str = "pubspec.yaml",
    xcode_container: str = "none",
    xcode_scheme: str = "none",
    xcode_configuration: str = "Release",
) -> str:
    if source_locale not in LOCALE_LABELS:
        raise ValueError(f"unsupported source locale: {source_locale}")
    source_label = LOCALE_LABELS[source_locale]
    return f"""---
schema_version: 8
app_version: {version}
build_number: {build}
previous_version: {previous}
source_commit: {commit}
project_type: {project_type}
version_source: {version_source}
xcode_container: {xcode_container}
xcode_scheme: {xcode_scheme}
xcode_configuration: {xcode_configuration}
form_status: draft
source_locale: {source_locale}
source_locale_label: {source_label}
source_copy_status: pending_approval
description_status: pending_approval
promotional_text_status: pending_approval
keywords_status: pending_approval
whats_new_status: pending_approval
localization_status: blocked_until_scope_and_source_copy_approved
description_policy: translate_selected_scope_then_compare_existing
existing_content_policy: ask_user_on_difference
computer_use_availability: pending_check
unlocalized_locale_policy: pending_user_choice
build_processing_status: pending
build_binding_status: unbound
review_status: not_added_for_review
localization_scope: pending_user_choice
locale_inventory_source: app_store_connect_ui
locale_inventory: {ALL_LOCALE_INVENTORY}
---

# App Store Connect 版本表单 — {version}

## 版本身份

- App：`Flair AI`
- 版本号：`{version}`
- 构建号：`{build}`
- 上一版本：`{previous}`
- 源码提交：`{commit}`
- 表单状态：`draft`

## 翻译源文案 — {source_label}（{source_locale}）

### 描述

```text
TODO_SOURCE_DESCRIPTION
```

### 推广文本

```text
TODO_SOURCE_PROMOTIONAL_TEXT
```

### 关键词

```text
TODO_SOURCE_KEYWORDS
```

### 此版本的新增内容

```text
TODO_SOURCE_WHATS_NEW
```

## 本地化元数据

{locale_sections(source_locale)}
## 稳定产品元数据

| 字段 | 策略 | 来源 |
| --- | --- | --- |
| 描述 | `translate_then_compare` | 本版本翻译源及用户确认范围内的译文；页面冲突由用户选择 |
| 关键词 | `translate_then_compare` | 本版本翻译源及用户确认范围内的译文；页面冲突由用户选择 |
| 支持网址 | `inherit` | {previous} |
| 营销网址 | `inherit` | {previous} |
| 版权 | `inherit` | {previous} |
| iPhone 截图 | `inherit` | {previous} |
| App 预览 | `inherit` | {previous} |

## 构建与审核

- 构建 {build}：`pending`、`unbound`。
- 审核登录：`REUSE_EXISTING_ASC_SAVED_INFORMATION`。
- 审核联系人：`REUSE_EXISTING_ASC_SAVED_INFORMATION`。
- 发布方式：`automatic`。
- 自动化终点：保存草稿并确认构建绑定；停在“添加以供审核”之前。

### 审核备注

```text
TODO_REVIEW_NOTES_WITHOUT_CREDENTIALS
```

## 合规与人工确认清单

- [ ] {source_label}描述、推广文本、关键词和此版本新增内容均已分别确认。
- [ ] 已读取 App Store Connect 的已本地化与未本地化语言清单。
- [ ] 已确认 Computer Use Skill 是否可用并记录所用浏览器控制方式。
- [ ] 已询问并记录是否翻译、创建未本地化语言。
- [ ] 已逐字段比较页面现值；所有差异均已由用户选择继承或覆盖。
- [ ] 用户确认范围内的语言均已填写、保存并回读核验。
- [ ] 模型正式名称与项目配置一致。
- [ ] 构建已完成 Apple 处理并绑定。
- [ ] 年龄分级、隐私、版权、订阅和 SDK 变化已复核。
- [ ] 未保存敏感信息。
- [ ] 未点击“添加以供审核”或正式提交。
"""


def command_new(args: argparse.Namespace) -> int:
    repo = Path(args.repo).expanduser().resolve()
    try:
        project = resolve_project_version(repo, args)
    except ValueError as error:
        print(f"Unable to determine project version: {error}", file=sys.stderr)
        return 1
    releases = release_dir(repo).resolve()
    target = (releases / f"{project.version}.md").resolve()
    if target.parent != releases:
        print("Refusing to create a release form outside the releases directory", file=sys.stderr)
        return 1
    if target.exists() and not args.force:
        print(f"Refusing to overwrite existing form: {target}", file=sys.stderr)
        return 1
    target.parent.mkdir(parents=True, exist_ok=True)
    source_locale = getattr(args, "source_locale", "zh-Hans")
    target.write_text(
        render_new(
            project.version,
            project.build,
            previous_release(repo, project.version),
            source_commit(repo),
            source_locale,
            project.project_type,
            project.version_source,
            project.xcode_container,
            project.xcode_scheme,
            project.xcode_configuration,
        ),
        encoding="utf-8",
    )
    print(target)
    return 0


def code_blocks(text: str, heading: str) -> list[str]:
    pattern = (
        rf"(?ms)^#{{3,4}}[ \t]+{re.escape(heading)}[ \t]*\n+"
        rf"```text\n(.*?)\n```"
    )
    return re.findall(pattern, text)


def strip_markdown_value(value: str) -> str:
    result = value.strip()
    if len(result) >= 2 and result.startswith("`") and result.endswith("`"):
        result = result[1:-1].strip()
    return result.replace("<br>", "\n")


def locale_section(text: str, locale: str) -> str | None:
    marker = f"<!-- locale:{locale} -->"
    start = text.find(marker)
    if start < 0:
        return None
    next_marker = text.find("<!-- locale:", start + len(marker))
    end = next_marker if next_marker >= 0 else text.find("\n## ", start)
    if end < 0:
        end = len(text)
    return text[start:end]


def locale_field(section: str, heading: str) -> str | None:
    match = re.search(
        rf"(?m)^- {re.escape(heading)}：[ \t]*(.*)$",
        section,
    )
    return strip_markdown_value(match.group(1)) if match else None


def is_placeholder(value: str | None) -> bool:
    return value is None or any(token in value for token in PLACEHOLDERS)


def validate_keywords(
    value: str,
    label: str,
    result: Result,
    *,
    enforce_minimum_term_length: bool = False,
) -> None:
    byte_length = len(value.encode("utf-8"))
    if byte_length > LIMITS["关键词"]:
        result.errors.append(
            f"{label} is {byte_length} UTF-8 bytes; limit is {LIMITS['关键词']} bytes"
        )
    if any(separator in value for separator in ("，", "、", ";", "；", "\n", "\r")):
        result.errors.append(f"{label} must use ASCII commas only")
    if value.startswith(",") or value.endswith(",") or ",," in value:
        result.errors.append(f"{label} contains a leading, trailing, or empty keyword")
    terms = [term.strip() for term in value.split(",")]
    if any(not term for term in terms):
        if not any("empty keyword" in item and label in item for item in result.errors):
            result.errors.append(f"{label} contains an empty keyword")
    short_terms = sorted(term for term in terms if term and len(term) <= 2)
    if enforce_minimum_term_length and short_terms:
        result.errors.append(
            f"{label} contains keywords shorter than 3 characters: "
            + ", ".join(short_terms)
        )
    normalized = [term.casefold() for term in terms if term]
    duplicates = sorted(
        term for term in set(normalized) if normalized.count(term) > 1
    )
    if duplicates:
        result.errors.append(
            f"{label} contains duplicate keywords: " + ", ".join(duplicates)
        )


def validate_schema_three(
    text: str,
    meta: dict[str, str],
    expected_locales: tuple[str, ...],
    is_draft: bool,
    result: Result,
) -> None:
    required = (
        "promotional_text_status",
        "keywords_status",
        "whats_new_status",
        "description_policy",
        "new_locale_description_status",
    )
    for key in required:
        if not meta.get(key):
            result.errors.append(f"missing schema 3 frontmatter field: {key}")

    if meta.get("description_policy") not in {
        "",
        "preserve_existing_except_new_locale_initialization",
    }:
        result.errors.append(
            "description_policy must be "
            "preserve_existing_except_new_locale_initialization"
        )

    copy_statuses = (
        meta.get("promotional_text_status"),
        meta.get("keywords_status"),
        meta.get("whats_new_status"),
    )
    all_approved = all(status == "approved" for status in copy_statuses)
    if meta.get("chinese_copy_status") == "approved" and not all_approved:
        result.errors.append(
            "chinese_copy_status cannot be approved until promotional text, "
            "keywords, and What's New are all approved"
        )
    if not is_draft and (not all_approved or meta.get("chinese_copy_status") != "approved"):
        result.errors.append(
            "ready-to-fill requires all three Chinese copy statuses and "
            "chinese_copy_status to be approved"
        )

    chinese_keyword_blocks = code_blocks(text, "关键词")
    if len(chinese_keyword_blocks) != 1:
        result.errors.append(
            f"schema 3 requires exactly one Chinese 关键词 block; found {len(chinese_keyword_blocks)}"
        )
    elif not is_placeholder(chinese_keyword_blocks[0]):
        validate_keywords(chinese_keyword_blocks[0], "Chinese keywords", result)

    has_new_locale = False
    for locale in expected_locales:
        section = locale_section(text, locale)
        if section is None:
            continue
        asc_state = locale_field(section, "App Store Connect 清单状态")
        strategy = locale_field(section, "描述策略")
        description_write = locale_field(section, "描述写入")

        if re.search(r"(?m)^- 描述：", section):
            result.errors.append(
                f"locale {locale} uses forbidden 描述 field; schema 3 must use 描述写入"
            )

        is_new_locale = asc_state == "unlocalized_add_required"
        has_new_locale |= is_new_locale
        if is_new_locale:
            if strategy != "initialize_new_locale":
                result.errors.append(
                    f"locale {locale} must initialize description while unlocalized"
                )
            if description_write in {None, "", "INHERIT_EXISTING_ASC_VALUE"}:
                result.errors.append(
                    f"locale {locale} requires a first-use description"
                )
            elif not is_draft and is_placeholder(description_write):
                result.errors.append(
                    f"locale {locale} still has a description placeholder"
                )
            elif not is_placeholder(description_write) and len(description_write) > LIMITS["描述"]:
                result.errors.append(
                    f"locale {locale} description is {len(description_write)} characters; "
                    f"limit is {LIMITS['描述']}"
                )
        else:
            if strategy != "preserve_existing":
                result.errors.append(
                    f"locale {locale} must preserve its existing description"
                )
            if description_write != "INHERIT_EXISTING_ASC_VALUE":
                result.errors.append(
                    f"locale {locale} attempts to overwrite an existing description"
                )

        for heading, limit in (
            ("推广文本", LIMITS["推广文本"]),
            ("关键词", LIMITS["关键词"]),
            ("此版本的新增内容", LIMITS["此版本的新增内容"]),
        ):
            value = locale_field(section, heading)
            if value is None:
                result.errors.append(f"locale {locale} is missing {heading}")
                continue
            if not is_draft and is_placeholder(value):
                result.errors.append(f"locale {locale} still has a {heading} placeholder")
                continue
            if heading != "关键词" and not is_placeholder(value) and len(value) > limit:
                result.errors.append(
                    f"locale {locale} {heading} is {len(value)} characters; limit is {limit}"
                )
            if heading == "关键词" and not is_placeholder(value):
                validate_keywords(value, f"locale {locale} keywords", result)

    if has_new_locale:
        if not is_draft and meta.get("new_locale_description_status") != "approved":
            result.errors.append(
                "ready-to-fill with new localizations requires "
                "new_locale_description_status: approved"
            )
        description_blocks = code_blocks(text, "新语言初始化描述")
        if len(description_blocks) != 1:
            result.errors.append(
                "schema 3 with new localizations requires exactly one "
                "新语言初始化描述 block"
            )
        elif not is_draft and is_placeholder(description_blocks[0]):
            result.errors.append("new-locale Chinese description is still a placeholder")


def validate_schema_four(
    text: str,
    meta: dict[str, str],
    expected_locales: tuple[str, ...],
    is_draft: bool,
    result: Result,
) -> None:
    required = (
        "description_status",
        "promotional_text_status",
        "keywords_status",
        "whats_new_status",
        "description_policy",
    )
    for key in required:
        if not meta.get(key):
            result.errors.append(f"missing schema 4 frontmatter field: {key}")

    if meta.get("description_policy") not in {"", "translate_all_locales"}:
        result.errors.append("description_policy must be translate_all_locales")

    copy_statuses = (
        meta.get("description_status"),
        meta.get("promotional_text_status"),
        meta.get("keywords_status"),
        meta.get("whats_new_status"),
    )
    all_approved = all(status == "approved" for status in copy_statuses)
    if meta.get("chinese_copy_status") == "approved" and not all_approved:
        result.errors.append(
            "chinese_copy_status cannot be approved until description, promotional "
            "text, keywords, and What's New are all approved"
        )
    if not is_draft and (not all_approved or meta.get("chinese_copy_status") != "approved"):
        result.errors.append(
            "ready-to-fill requires all four Chinese copy statuses and "
            "chinese_copy_status to be approved"
        )

    chinese_description_blocks = code_blocks(text, "描述")
    if len(chinese_description_blocks) != 1:
        result.errors.append(
            "schema 4 requires exactly one Chinese 描述 block; "
            f"found {len(chinese_description_blocks)}"
        )
    elif not is_draft and is_placeholder(chinese_description_blocks[0]):
        result.errors.append("Chinese description is still a placeholder")

    chinese_keyword_blocks = code_blocks(text, "关键词")
    if len(chinese_keyword_blocks) != 1:
        result.errors.append(
            "schema 4 requires exactly one Chinese 关键词 block; "
            f"found {len(chinese_keyword_blocks)}"
        )
    elif not is_placeholder(chinese_keyword_blocks[0]):
        validate_keywords(chinese_keyword_blocks[0], "Chinese keywords", result)

    for locale in expected_locales:
        section = locale_section(text, locale)
        if section is None:
            continue
        strategy = locale_field(section, "描述策略")
        if strategy != "translate_and_replace":
            result.errors.append(
                f"locale {locale} description strategy must be translate_and_replace"
            )
        if re.search(r"(?m)^- 描述写入：", section):
            result.errors.append(
                f"locale {locale} uses legacy 描述写入 field; schema 4 must use 描述"
            )

        for heading, limit in (
            ("描述", LIMITS["描述"]),
            ("推广文本", LIMITS["推广文本"]),
            ("关键词", LIMITS["关键词"]),
            ("此版本的新增内容", LIMITS["此版本的新增内容"]),
        ):
            value = locale_field(section, heading)
            if value is None:
                result.errors.append(f"locale {locale} is missing {heading}")
                continue
            if value == "INHERIT_EXISTING_ASC_VALUE":
                result.errors.append(
                    f"locale {locale} must translate and replace its description"
                )
                continue
            if not is_draft and is_placeholder(value):
                result.errors.append(f"locale {locale} still has a {heading} placeholder")
                continue
            if heading != "关键词" and not is_placeholder(value) and len(value) > limit:
                result.errors.append(
                    f"locale {locale} {heading} is {len(value)} characters; limit is {limit}"
                )
            if heading == "关键词" and not is_placeholder(value):
                validate_keywords(value, f"locale {locale} keywords", result)


def validate_schema_five(
    text: str,
    meta: dict[str, str],
    expected_locales: tuple[str, ...],
    is_draft: bool,
    result: Result,
) -> None:
    required = (
        "source_locale",
        "source_locale_label",
        "source_copy_status",
        "description_status",
        "promotional_text_status",
        "keywords_status",
        "whats_new_status",
        "description_policy",
    )
    for key in required:
        if not meta.get(key):
            result.errors.append(f"missing schema 5 frontmatter field: {key}")

    source_locale = meta.get("source_locale", "")
    if source_locale and source_locale not in expected_locales:
        result.errors.append(
            f"source_locale {source_locale} is not declared in locale_inventory"
        )
    expected_label = LOCALE_LABELS.get(source_locale)
    if expected_label and meta.get("source_locale_label") != expected_label:
        result.errors.append(
            f"source_locale_label must be {expected_label} for {source_locale}"
        )
    if meta.get("description_policy") not in {"", "translate_all_locales"}:
        result.errors.append("description_policy must be translate_all_locales")

    copy_statuses = (
        meta.get("description_status"),
        meta.get("promotional_text_status"),
        meta.get("keywords_status"),
        meta.get("whats_new_status"),
    )
    all_approved = all(status == "approved" for status in copy_statuses)
    if meta.get("source_copy_status") == "approved" and not all_approved:
        result.errors.append(
            "source_copy_status cannot be approved until description, promotional "
            "text, keywords, and What's New are all approved"
        )
    if not is_draft and (not all_approved or meta.get("source_copy_status") != "approved"):
        result.errors.append(
            "ready-to-fill requires all four source copy statuses and "
            "source_copy_status to be approved"
        )

    source_blocks: dict[str, str] = {}
    for heading in ("描述", "推广文本", "关键词", "此版本的新增内容"):
        blocks = code_blocks(text, heading)
        if len(blocks) != 1:
            result.errors.append(
                f"schema 5 requires exactly one source {heading} block; found {len(blocks)}"
            )
            continue
        source_blocks[heading] = blocks[0]
        if not is_draft and is_placeholder(blocks[0]):
            result.errors.append(f"source {heading} is still a placeholder")
        if heading == "关键词" and not is_placeholder(blocks[0]):
            validate_keywords(blocks[0], "source keywords", result)

    for locale in expected_locales:
        section = locale_section(text, locale)
        if section is None:
            continue
        strategy = locale_field(section, "描述策略")
        if strategy != "translate_and_replace":
            result.errors.append(
                f"locale {locale} description strategy must be translate_and_replace"
            )
        if re.search(r"(?m)^- 描述写入：", section):
            result.errors.append(
                f"locale {locale} uses legacy 描述写入 field; schema 5 must use 描述"
            )

        for heading, limit in (
            ("描述", LIMITS["描述"]),
            ("推广文本", LIMITS["推广文本"]),
            ("关键词", LIMITS["关键词"]),
            ("此版本的新增内容", LIMITS["此版本的新增内容"]),
        ):
            value = locale_field(section, heading)
            if value is None:
                result.errors.append(f"locale {locale} is missing {heading}")
                continue
            if value == "INHERIT_EXISTING_ASC_VALUE":
                result.errors.append(
                    f"locale {locale} must translate and replace its description"
                )
                continue
            if not is_draft and is_placeholder(value):
                result.errors.append(f"locale {locale} still has a {heading} placeholder")
                continue
            if heading != "关键词" and not is_placeholder(value) and len(value) > limit:
                result.errors.append(
                    f"locale {locale} {heading} is {len(value)} characters; limit is {limit}"
                )
            if heading == "关键词" and not is_placeholder(value):
                validate_keywords(value, f"locale {locale} keywords", result)
            if (
                locale == source_locale
                and heading in source_blocks
                and not is_placeholder(value)
                and not is_placeholder(source_blocks[heading])
                and value != source_blocks[heading]
            ):
                result.errors.append(
                    f"source locale {source_locale} {heading} must exactly match its approved source block"
                )


def validate_schema_six(
    text: str,
    meta: dict[str, str],
    expected_locales: tuple[str, ...],
    is_draft: bool,
    result: Result,
) -> None:
    required = (
        "source_locale",
        "source_locale_label",
        "source_copy_status",
        "description_status",
        "promotional_text_status",
        "keywords_status",
        "whats_new_status",
        "description_policy",
        "existing_content_policy",
    )
    for key in required:
        if not meta.get(key):
            result.errors.append(f"missing schema 6 frontmatter field: {key}")

    source_locale = meta.get("source_locale", "")
    if source_locale and source_locale not in expected_locales:
        result.errors.append(
            f"source_locale {source_locale} is not declared in locale_inventory"
        )
    expected_label = LOCALE_LABELS.get(source_locale)
    if expected_label and meta.get("source_locale_label") != expected_label:
        result.errors.append(
            f"source_locale_label must be {expected_label} for {source_locale}"
        )
    if meta.get("description_policy") not in {
        "",
        "translate_all_then_compare_existing",
    }:
        result.errors.append(
            "description_policy must be translate_all_then_compare_existing"
        )
    if meta.get("existing_content_policy") not in {
        "",
        "ask_user_on_difference",
    }:
        result.errors.append(
            "existing_content_policy must be ask_user_on_difference"
        )

    copy_statuses = (
        meta.get("description_status"),
        meta.get("promotional_text_status"),
        meta.get("keywords_status"),
        meta.get("whats_new_status"),
    )
    all_approved = all(status == "approved" for status in copy_statuses)
    if meta.get("source_copy_status") == "approved" and not all_approved:
        result.errors.append(
            "source_copy_status cannot be approved until description, promotional "
            "text, keywords, and What's New are all approved"
        )
    if not is_draft and (not all_approved or meta.get("source_copy_status") != "approved"):
        result.errors.append(
            "ready-to-fill requires all four source copy statuses and "
            "source_copy_status to be approved"
        )

    source_blocks: dict[str, str] = {}
    for heading in PUBLIC_COPY_FIELDS:
        blocks = code_blocks(text, heading)
        if len(blocks) != 1:
            result.errors.append(
                f"schema 6 requires exactly one source {heading} block; found {len(blocks)}"
            )
            continue
        source_blocks[heading] = blocks[0]
        if not is_draft and is_placeholder(blocks[0]):
            result.errors.append(f"source {heading} is still a placeholder")
        if heading == "关键词" and not is_placeholder(blocks[0]):
            validate_keywords(blocks[0], "source keywords", result)

    comparison_complete = meta.get("localization_status") == "saved_and_read_back"
    for locale in expected_locales:
        section = locale_section(text, locale)
        if section is None:
            continue
        asc_state = locale_field(section, "App Store Connect 清单状态")
        if re.search(r"(?m)^- 描述策略：|- 描述写入：", section):
            result.errors.append(
                f"locale {locale} uses a legacy description strategy field"
            )

        for heading, limit in (
            ("描述", LIMITS["描述"]),
            ("推广文本", LIMITS["推广文本"]),
            ("关键词", LIMITS["关键词"]),
            ("此版本的新增内容", LIMITS["此版本的新增内容"]),
        ):
            strategy = locale_field(section, f"{heading}页面策略")
            if strategy is None:
                result.errors.append(
                    f"locale {locale} is missing {heading}页面策略"
                )
            elif strategy not in PAGE_STRATEGIES:
                result.errors.append(
                    f"locale {locale} {heading}页面策略 is invalid: {strategy}"
                )
            elif comparison_complete and strategy == "pending_page_comparison":
                result.errors.append(
                    f"locale {locale} {heading} still awaits page comparison"
                )
            elif (
                asc_state == "unlocalized_add_required"
                and strategy == "inherit_after_user_confirmation"
            ):
                result.errors.append(
                    f"locale {locale} cannot inherit {heading} before localization creation"
                )

            value = locale_field(section, heading)
            if value is None:
                result.errors.append(f"locale {locale} is missing {heading}")
                continue
            if value == "INHERIT_EXISTING_ASC_VALUE":
                result.errors.append(
                    f"locale {locale} must retain a prepared translation for {heading}"
                )
                continue
            if not is_draft and is_placeholder(value):
                result.errors.append(f"locale {locale} still has a {heading} placeholder")
                continue
            if heading != "关键词" and not is_placeholder(value) and len(value) > limit:
                result.errors.append(
                    f"locale {locale} {heading} is {len(value)} characters; limit is {limit}"
                )
            if heading == "关键词" and not is_placeholder(value):
                validate_keywords(value, f"locale {locale} keywords", result)
            if (
                locale == source_locale
                and heading in source_blocks
                and not is_placeholder(value)
                and not is_placeholder(source_blocks[heading])
                and value != source_blocks[heading]
            ):
                result.errors.append(
                    f"source locale {source_locale} {heading} must exactly match its approved source block"
                )


def validate_schema_seven(
    text: str,
    meta: dict[str, str],
    expected_locales: tuple[str, ...],
    is_draft: bool,
    result: Result,
) -> None:
    schema_name = meta.get("schema_version", "7")
    enforce_minimum_term_length = schema_name == "8"
    required = (
        "source_locale",
        "source_locale_label",
        "source_copy_status",
        "description_status",
        "promotional_text_status",
        "keywords_status",
        "whats_new_status",
        "description_policy",
        "existing_content_policy",
        "computer_use_availability",
        "unlocalized_locale_policy",
    )
    for key in required:
        if not meta.get(key):
            result.errors.append(f"missing schema {schema_name} frontmatter field: {key}")

    source_locale = meta.get("source_locale", "")
    if source_locale and source_locale not in expected_locales:
        result.errors.append(
            f"source_locale {source_locale} is not declared in locale_inventory"
        )
    expected_label = LOCALE_LABELS.get(source_locale)
    if expected_label and meta.get("source_locale_label") != expected_label:
        result.errors.append(
            f"source_locale_label must be {expected_label} for {source_locale}"
        )
    if meta.get("description_policy") not in {
        "",
        "translate_selected_scope_then_compare_existing",
    }:
        result.errors.append(
            "description_policy must be translate_selected_scope_then_compare_existing"
        )
    if meta.get("existing_content_policy") not in {
        "",
        "ask_user_on_difference",
    }:
        result.errors.append(
            "existing_content_policy must be ask_user_on_difference"
        )

    scope = meta.get("localization_scope", "")
    unlocalized_policy = meta.get("unlocalized_locale_policy", "")
    computer_use = meta.get("computer_use_availability", "")
    if scope not in LOCALIZATION_SCOPES | {""}:
        result.errors.append(f"invalid localization_scope: {scope}")
    if unlocalized_policy not in UNLOCALIZED_LOCALE_POLICIES | {""}:
        result.errors.append(
            f"invalid unlocalized_locale_policy: {unlocalized_policy}"
        )
    if computer_use not in COMPUTER_USE_AVAILABILITY | {""}:
        result.errors.append(
            f"invalid computer_use_availability: {computer_use}"
        )
    if scope == "app_store_connect_localized_languages" and unlocalized_policy != "exclude_after_user_confirmation":
        result.errors.append(
            "localized-only scope requires unlocalized_locale_policy: exclude_after_user_confirmation"
        )
    if scope == "app_store_connect_all_languages" and unlocalized_policy != "include_after_user_confirmation":
        result.errors.append(
            "all-language scope requires unlocalized_locale_policy: include_after_user_confirmation"
        )
    if not is_draft and scope == "pending_user_choice":
        result.errors.append(
            "ready-to-fill requires an explicit localization_scope choice"
        )
    if not is_draft and unlocalized_policy == "pending_user_choice":
        result.errors.append(
            "ready-to-fill requires the user's unlocalized-language choice"
        )
    if not is_draft and computer_use == "pending_check":
        result.errors.append(
            "ready-to-fill requires a current Computer Use availability check"
        )

    copy_statuses = (
        meta.get("description_status"),
        meta.get("promotional_text_status"),
        meta.get("keywords_status"),
        meta.get("whats_new_status"),
    )
    all_approved = all(status == "approved" for status in copy_statuses)
    if meta.get("source_copy_status") == "approved" and not all_approved:
        result.errors.append(
            "source_copy_status cannot be approved until description, promotional "
            "text, keywords, and What's New are all approved"
        )
    if not is_draft and (not all_approved or meta.get("source_copy_status") != "approved"):
        result.errors.append(
            "ready-to-fill requires all four source copy statuses and "
            "source_copy_status to be approved"
        )

    source_blocks: dict[str, str] = {}
    for heading in PUBLIC_COPY_FIELDS:
        blocks = code_blocks(text, heading)
        if len(blocks) != 1:
            result.errors.append(
                f"schema {schema_name} requires exactly one source {heading} block; found {len(blocks)}"
            )
            continue
        source_blocks[heading] = blocks[0]
        if not is_draft and is_placeholder(blocks[0]):
            result.errors.append(f"source {heading} is still a placeholder")
        if heading == "关键词" and not is_placeholder(blocks[0]):
            validate_keywords(
                blocks[0],
                "source keywords",
                result,
                enforce_minimum_term_length=enforce_minimum_term_length,
            )

    comparison_complete = meta.get("localization_status") == "saved_and_read_back"
    for locale in expected_locales:
        section = locale_section(text, locale)
        if section is None:
            continue
        asc_state = locale_field(section, "App Store Connect 清单状态")
        locale_status = locale_field(section, "状态")
        excluded = (
            scope == "app_store_connect_localized_languages"
            and asc_state == "unlocalized_add_required"
        )
        if locale == source_locale and excluded:
            result.errors.append(
                f"source_locale {source_locale} is excluded by localized-only scope"
            )
        if re.search(r"(?m)^- 描述策略：|- 描述写入：", section):
            result.errors.append(
                f"locale {locale} uses a legacy description strategy field"
            )

        if excluded and locale_status != "not_requested_by_user":
            result.errors.append(
                f"excluded locale {locale} must have status not_requested_by_user"
            )

        for heading, limit in (
            ("描述", LIMITS["描述"]),
            ("推广文本", LIMITS["推广文本"]),
            ("关键词", LIMITS["关键词"]),
            ("此版本的新增内容", LIMITS["此版本的新增内容"]),
        ):
            strategy = locale_field(section, f"{heading}页面策略")
            value = locale_field(section, heading)
            if excluded:
                if strategy != "not_in_scope":
                    result.errors.append(
                        f"excluded locale {locale} {heading}页面策略 must be not_in_scope"
                    )
                if value is None or not is_placeholder(value):
                    result.errors.append(
                        f"excluded locale {locale} must not contain translated {heading}"
                    )
                continue

            if strategy is None:
                result.errors.append(
                    f"locale {locale} is missing {heading}页面策略"
                )
            elif strategy not in PAGE_STRATEGIES:
                result.errors.append(
                    f"locale {locale} {heading}页面策略 is invalid: {strategy}"
                )
            elif strategy == "not_in_scope" and scope != "pending_user_choice":
                result.errors.append(
                    f"in-scope locale {locale} {heading} cannot use not_in_scope"
                )
            elif comparison_complete and strategy == "pending_page_comparison":
                result.errors.append(
                    f"locale {locale} {heading} still awaits page comparison"
                )
            elif (
                asc_state == "unlocalized_add_required"
                and strategy == "inherit_after_user_confirmation"
            ):
                result.errors.append(
                    f"locale {locale} cannot inherit {heading} before localization creation"
                )

            if value is None:
                result.errors.append(f"locale {locale} is missing {heading}")
                continue
            if value == "INHERIT_EXISTING_ASC_VALUE":
                result.errors.append(
                    f"locale {locale} must retain a prepared translation for {heading}"
                )
                continue
            if not is_draft and is_placeholder(value):
                result.errors.append(f"locale {locale} still has a {heading} placeholder")
                continue
            if heading != "关键词" and not is_placeholder(value) and len(value) > limit:
                result.errors.append(
                    f"locale {locale} {heading} is {len(value)} characters; limit is {limit}"
                )
            if heading == "关键词" and not is_placeholder(value):
                validate_keywords(
                    value,
                    f"locale {locale} keywords",
                    result,
                    enforce_minimum_term_length=enforce_minimum_term_length,
                )
            if (
                locale == source_locale
                and heading in source_blocks
                and not is_placeholder(value)
                and not is_placeholder(source_blocks[heading])
                and value != source_blocks[heading]
            ):
                result.errors.append(
                    f"source locale {source_locale} {heading} must exactly match its approved source block"
                )


def validate_schema_eight(meta: dict[str, str], result: Result) -> None:
    required = (
        "project_type",
        "version_source",
        "xcode_container",
        "xcode_scheme",
        "xcode_configuration",
    )
    for key in required:
        if not meta.get(key):
            result.errors.append(f"missing schema 8 frontmatter field: {key}")
    project_type = meta.get("project_type", "")
    if project_type not in {"flutter", "xcode", "unknown"}:
        result.errors.append("schema 8 project_type must be flutter, xcode, or unknown")
    if meta.get("version_source") not in {"pubspec.yaml", "xcodebuild", "explicit"}:
        result.errors.append(
            "schema 8 version_source must be pubspec.yaml, xcodebuild, or explicit"
        )
    if project_type == "xcode":
        if meta.get("xcode_container") in {"", "none"}:
            result.errors.append("schema 8 Xcode form requires xcode_container")
        if meta.get("xcode_scheme") in {"", "none"}:
            result.errors.append("schema 8 Xcode form requires xcode_scheme")
    elif project_type == "flutter" and meta.get("version_source") == "xcodebuild":
        result.errors.append("Flutter form cannot use xcodebuild as version_source")
    if project_type == "unknown" and meta.get("version_source") != "explicit":
        result.errors.append("unknown project_type requires explicit version_source")


def configured_model_names(repo: Path) -> set[str]:
    names: set[str] = set()
    for path in (repo / "assets" / "json").glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        def walk(value: object) -> None:
            if isinstance(value, dict):
                name = value.get("name")
                if isinstance(name, str):
                    names.add(name)
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        walk(data)
    return names


def validate_form(path: Path, repo: Path | None) -> Result:
    text = path.read_text(encoding="utf-8")
    meta = read_frontmatter(text)
    result = Result()
    required = (
        "schema_version",
        "app_version",
        "build_number",
        "previous_version",
        "source_commit",
        "form_status",
        "localization_status",
        "build_processing_status",
        "build_binding_status",
        "review_status",
    )
    for key in required:
        if not meta.get(key):
            result.errors.append(f"missing frontmatter field: {key}")

    try:
        schema_version = int(meta.get("schema_version", "0"))
    except ValueError:
        schema_version = 0
        result.errors.append("schema_version must be an integer")
    if schema_version not in range(1, 9):
        result.errors.append(
            f"unsupported schema_version: {schema_version}; supported versions are 1 through 8"
        )

    if schema_version <= 4 and not meta.get("chinese_copy_status"):
        result.errors.append("missing frontmatter field: chinese_copy_status")
    if schema_version >= 5 and not meta.get("source_copy_status"):
        result.errors.append("missing frontmatter field: source_copy_status")

    if schema_version >= 2:
        for key in ("localization_scope", "locale_inventory_source", "locale_inventory"):
            if not meta.get(key):
                result.errors.append(f"missing schema 2 frontmatter field: {key}")
        if schema_version <= 6:
            if meta.get("localization_scope") not in {"", "app_store_connect_all_languages"}:
                result.errors.append(
                    "localization_scope must be app_store_connect_all_languages"
                )
        elif meta.get("localization_scope") not in LOCALIZATION_SCOPES | {""}:
            result.errors.append(
                "schema 7 localization_scope must be pending_user_choice, "
                "app_store_connect_localized_languages, or app_store_connect_all_languages"
            )
        expected_locales = tuple(
            value.strip()
            for value in meta.get("locale_inventory", "").split(",")
            if value.strip()
        )
        duplicates = sorted(
            locale for locale in set(expected_locales) if expected_locales.count(locale) > 1
        )
        if duplicates:
            result.errors.append(
                "duplicate locale IDs in locale_inventory: " + ", ".join(duplicates)
            )
        missing_baseline = [
            locale for locale in ALL_LOCALE_IDS if locale not in expected_locales
        ]
        if missing_baseline:
            result.errors.append(
                "locale_inventory omits current App Store Connect baseline: "
                + ", ".join(missing_baseline)
            )
    else:
        expected_locales = LEGACY_LOCALE_IDS

    for locale in expected_locales:
        count = text.count(f"<!-- locale:{locale} -->")
        if count != 1:
            result.errors.append(f"locale marker {locale} occurs {count} times")

    locale_markers = re.findall(r"<!-- locale:([^ >]+) -->", text)
    unexpected = sorted(set(locale_markers) - set(expected_locales))
    if unexpected:
        result.errors.append(
            "locale markers not declared in locale_inventory: " + ", ".join(unexpected)
        )

    is_draft = meta.get("form_status") in {"draft", "historical_published"}
    present_placeholders = sorted(token for token in PLACEHOLDERS if token in text)
    if (
        schema_version >= 7
        and meta.get("localization_scope") == "app_store_connect_localized_languages"
    ):
        present_placeholders = [
            token for token in present_placeholders if token != "TODO_AFTER_SCOPE_CHOICE"
        ]
    if present_placeholders:
        message = "placeholders remain: " + ", ".join(present_placeholders)
        (result.warnings if is_draft else result.errors).append(message)

    if schema_version == 3:
        validate_schema_three(text, meta, expected_locales, is_draft, result)
    elif schema_version == 4:
        validate_schema_four(text, meta, expected_locales, is_draft, result)
    elif schema_version == 5:
        validate_schema_five(text, meta, expected_locales, is_draft, result)
    elif schema_version == 6:
        validate_schema_six(text, meta, expected_locales, is_draft, result)
    elif schema_version in {7, 8}:
        validate_schema_seven(text, meta, expected_locales, is_draft, result)
        if schema_version == 8:
            validate_schema_eight(meta, result)

    for heading, limit in LIMITS.items():
        for index, value in enumerate(code_blocks(text, heading), start=1):
            length = len(value.encode("utf-8")) if heading == "关键词" else len(value)
            unit = "UTF-8 bytes" if heading == "关键词" else "characters"
            if length > limit:
                result.errors.append(
                    f"{heading} block {index} is {length} {unit}; limit is {limit}"
                )

    secret_patterns = (
        (r"(?im)^\s*(?:password|passwd|review_password)\s*[:=]\s*(?!`?(?:REUSE|DO_NOT_STORE))\S+", "password-like value"),
        (r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", "private key"),
        (r"\bsk-[A-Za-z0-9_-]{20,}\b", "API key"),
        (r"(?im)^\s*(?:phone|telephone|电话号码)\s*[:：=]\s*\+\d", "phone number"),
        (r"\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.", "JWT/token"),
    )
    for pattern, label in secret_patterns:
        if re.search(pattern, text):
            result.errors.append(f"possible sensitive information: {label}")

    public_copy = "\n".join(re.findall(r"```text\n(.*?)\n```", text, re.S))
    if "Happy House" in public_copy:
        result.errors.append("model typo: use Happy Horse 1.1, not Happy House 1.1")

    if (
        repo
        and schema_version == 8
        and not (
            meta.get("project_type") == "unknown"
            and meta.get("version_source") == "explicit"
        )
    ):
        project_args = argparse.Namespace(
            version=(
                meta.get("app_version")
                if meta.get("version_source") == "explicit"
                else None
            ),
            build=(
                meta.get("build_number")
                if meta.get("version_source") == "explicit"
                else None
            ),
            project_type=meta.get("project_type", "auto"),
            workspace=(
                meta.get("xcode_container")
                if meta.get("xcode_container", "").endswith(".xcworkspace")
                else None
            ),
            project=(
                meta.get("xcode_container")
                if meta.get("xcode_container", "").endswith(".xcodeproj")
                else None
            ),
            scheme=(
                None if meta.get("xcode_scheme") in {"", "none"} else meta.get("xcode_scheme")
            ),
            configuration=meta.get("xcode_configuration", "Release"),
        )
        try:
            detected = resolve_project_version(repo, project_args)
        except ValueError as error:
            result.errors.append(f"cannot verify schema 8 project version: {error}")
        else:
            if meta.get("app_version") == detected.version and meta.get("form_status") != "historical_published":
                if meta.get("build_number") != detected.build:
                    result.errors.append(
                        f"build mismatch: form={meta.get('build_number')} project={detected.build}"
                    )
    elif repo and schema_version == 8:
        try:
            validate_version_identifiers(
                meta.get("app_version", ""), meta.get("build_number", "")
            )
        except ValueError as error:
            result.errors.append(f"invalid explicit schema 8 version: {error}")
    elif repo and (repo / "pubspec.yaml").exists():
        current_version, current_build = read_pubspec_version(repo)
        if meta.get("app_version") == current_version and meta.get("form_status") != "historical_published":
            if meta.get("build_number") != current_build:
                result.errors.append(
                    f"build mismatch: form={meta.get('build_number')} pubspec={current_build}"
                )
    if repo:
        names = configured_model_names(repo)
        if "Happy Horse 1.1" in text and "Happy Horse 1.1" not in names:
            result.errors.append("Happy Horse 1.1 is not present in repository model configuration")

    aggregate_copy_status = (
        meta.get("source_copy_status", "")
        if schema_version >= 5
        else meta.get("chinese_copy_status", "")
    )
    if aggregate_copy_status.startswith("pending"):
        result.warnings.append(
            "source release copy is not fully approved; do not translate or fill public copy"
        )
    if meta.get("review_status") == "not_added_for_review":
        result.warnings.append("draft boundary active: stop before Add for Review")
    return result


def command_validate(args: argparse.Namespace) -> int:
    path = Path(args.path).expanduser().resolve()
    repo = Path(args.repo).expanduser().resolve() if args.repo else None
    targets = sorted(path.glob("[0-9]*.md")) if path.is_dir() else [path]
    status = 0
    for target in targets:
        status |= validate_form(target, repo).emit(target)
    return status


ASO_FIELD_HEADINGS = {
    "description": "描述",
    "promotional_text": "推广文本",
    "keywords": "关键词",
    "whats_new": "此版本的新增内容",
}


def validate_aso_handoff(data: object) -> tuple[Result, dict[str, str]]:
    result = Result()
    values: dict[str, str] = {}
    if not isinstance(data, dict):
        result.errors.append("ASO handoff must be a JSON object")
        return result, values
    if data.get("schema_version") != 1:
        result.errors.append("ASO handoff schema_version must be 1")
    if data.get("approval_status") != "approved":
        result.errors.append("ASO handoff approval_status must be approved")
    source_locale = data.get("source_locale")
    if source_locale not in ALL_LOCALE_IDS:
        result.errors.append("ASO handoff source_locale is unsupported")
    generated_at = data.get("generated_at")
    try:
        datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
    except ValueError:
        result.errors.append("ASO handoff generated_at must be an ISO 8601 timestamp")
    sources = data.get("sources")
    if not isinstance(sources, list) or not sources or not all(
        isinstance(item, str) and item.startswith(("https://", "http://"))
        for item in sources
    ):
        result.errors.append("ASO handoff sources must contain at least one URL")
    fields = data.get("fields")
    if not isinstance(fields, dict):
        result.errors.append("ASO handoff fields must be an object")
        return result, values
    for key, heading in ASO_FIELD_HEADINGS.items():
        field_data = fields.get(key)
        if not isinstance(field_data, dict):
            result.errors.append(f"ASO handoff is missing field: {key}")
            continue
        if field_data.get("approval_status") != "approved":
            result.errors.append(f"ASO handoff field {key} is not approved")
        value = field_data.get("value")
        if not isinstance(value, str) or not value.strip():
            result.errors.append(f"ASO handoff field {key} has no value")
            continue
        values[key] = value.strip()
        if (
            re.search(r"(?m)^ {0,3}`{3,}[ \t]*$", values[key])
            or "<!-- locale:" in values[key]
        ):
            result.errors.append(
                f"ASO handoff field {key} contains reserved release-form markup"
            )
        if key == "keywords":
            validate_keywords(
                values[key],
                "ASO handoff keywords",
                result,
                enforce_minimum_term_length=True,
            )
        elif len(values[key]) > LIMITS[heading]:
            result.errors.append(
                f"ASO handoff {key} is {len(values[key])} characters; "
                f"limit is {LIMITS[heading]}"
            )
    return result, values


def _replace_source_block(text: str, heading: str, value: str) -> str:
    pattern = (
        rf"(?ms)(^### {re.escape(heading)}[ \t]*\n+```text\n).*?(\n```)"
    )
    matches = list(re.finditer(pattern, text))
    if len(matches) != 1:
        raise ValueError(f"release form must contain one source {heading} block")
    match = matches[0]
    return text[: match.start()] + match.group(1) + value + match.group(2) + text[match.end() :]


def _replace_frontmatter_value(text: str, key: str, value: str) -> str:
    pattern = rf"(?m)^({re.escape(key)}:\s*).*$"
    updated, count = re.subn(pattern, lambda match: match.group(1) + value, text, count=1)
    if count != 1:
        raise ValueError(f"release form is missing frontmatter field: {key}")
    return updated


def _replace_locale_field(text: str, locale: str, heading: str, value: str) -> str:
    marker = f"<!-- locale:{locale} -->"
    start = text.find(marker)
    if start < 0:
        raise ValueError(f"release form has no locale section for {locale}")
    next_marker = text.find("<!-- locale:", start + len(marker))
    end = next_marker if next_marker >= 0 else text.find("\n## ", start)
    if end < 0:
        end = len(text)
    section = text[start:end]
    safe_value = value.replace("\n", "<br>")
    pattern = rf"(?m)^(- {re.escape(heading)}：)[ \t]*.*$"
    replaced, count = re.subn(pattern, lambda match: match.group(1) + safe_value, section, count=1)
    if count != 1:
        raise ValueError(f"locale {locale} is missing {heading}")
    return text[:start] + replaced + text[end:]


def command_import_aso(args: argparse.Namespace) -> int:
    handoff_path = Path(args.handoff).expanduser().resolve()
    form_path = Path(args.form).expanduser().resolve()
    try:
        data = json.loads(handoff_path.read_text(encoding="utf-8"))
        text = form_path.read_text(encoding="utf-8")
    except (OSError, json.JSONDecodeError) as error:
        print(f"Unable to read ASO handoff or release form: {error}", file=sys.stderr)
        return 1
    result, values = validate_aso_handoff(data)
    meta = read_frontmatter(text)
    try:
        schema_version = int(meta.get("schema_version", "0") or 0)
    except ValueError:
        schema_version = 0
    if schema_version not in range(5, 9):
        result.errors.append("ASO import requires release form schema 5 through 8")
    if isinstance(data, dict) and data.get("source_locale") != meta.get("source_locale"):
        result.errors.append(
            "ASO handoff source_locale does not match release form source_locale"
        )
    if result.errors:
        return result.emit(handoff_path)
    try:
        for key, heading in ASO_FIELD_HEADINGS.items():
            text = _replace_source_block(text, heading, values[key])
            text = _replace_locale_field(
                text, str(data["source_locale"]), heading, values[key]
            )
        text = _replace_locale_field(
            text, str(data["source_locale"]), "状态", "source_copy_approved"
        )
        for key in (
            "description_status",
            "promotional_text_status",
            "keywords_status",
            "whats_new_status",
            "source_copy_status",
        ):
            text = _replace_frontmatter_value(text, key, "approved")
    except ValueError as error:
        print(f"Refusing ASO import: {error}", file=sys.stderr)
        return 1
    form_path.write_text(text, encoding="utf-8")
    print(f"Imported four approved App Store fields into {form_path}")
    print("App Name and Subtitle recommendations were not applied.")
    return 0


def command_summary(args: argparse.Namespace) -> int:
    repo = Path(args.repo).expanduser().resolve()
    print("| Version | Build | Form | Source copy | Localizations | Build binding | Review |")
    print("| --- | ---: | --- | --- | --- | --- | --- |")
    files = [
        path
        for path in release_dir(repo).glob("[0-9]*.md")
        if read_frontmatter(path.read_text(encoding="utf-8")).get("app_version")
    ]
    for path in sorted(files, key=lambda item: version_key(item.stem)):
        meta = read_frontmatter(path.read_text(encoding="utf-8"))
        print(
            f"| {meta['app_version']} | {meta['build_number']} | {meta['form_status']} | "
            f"{meta.get('source_copy_status', meta.get('chinese_copy_status', 'unknown'))} | "
            f"{meta['localization_status']} | "
            f"{meta['build_binding_status']} | {meta['review_status']} |"
        )
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subparsers = result.add_subparsers(dest="command", required=True)

    new = subparsers.add_parser("new", help="create a form from Flutter or Xcode project metadata")
    new.add_argument("--repo", required=True)
    new.add_argument(
        "--project-type", choices=("auto", "flutter", "xcode"), default="auto"
    )
    new.add_argument("--workspace", help="path to an .xcworkspace inside the repository")
    new.add_argument("--project", help="path to an .xcodeproj inside the repository")
    new.add_argument("--scheme", help="shared Xcode scheme")
    new.add_argument("--configuration", default="Release")
    new.add_argument("--version", help="marketing version; requires --build")
    new.add_argument("--build", help="build number; requires --version")
    new.add_argument(
        "--source-locale",
        default="zh-Hans",
        choices=ALL_LOCALE_IDS,
        help="App Store Connect locale used as the translation source (default: zh-Hans)",
    )
    new.add_argument("--force", action="store_true")
    new.set_defaults(func=command_new)

    validate = subparsers.add_parser("validate", help="validate one form or a release directory")
    validate.add_argument("path")
    validate.add_argument("--repo")
    validate.set_defaults(func=command_validate)

    summary = subparsers.add_parser("summary", help="print a safe release status table")
    summary.add_argument("--repo", required=True)
    summary.set_defaults(func=command_summary)

    import_aso = subparsers.add_parser(
        "import-aso", help="import four independently approved fields from aso-handoff.json"
    )
    import_aso.add_argument("handoff")
    import_aso.add_argument("form")
    import_aso.set_defaults(func=command_import_aso)
    return result


def main() -> int:
    args = parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
