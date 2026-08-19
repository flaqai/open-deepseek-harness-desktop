from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "release_form.py"
SPEC = importlib.util.spec_from_file_location("release_form", SCRIPT)
assert SPEC and SPEC.loader
release_form = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = release_form
SPEC.loader.exec_module(release_form)


class ReleaseFormTests(unittest.TestCase):
    def test_new_form_uses_schema_eight_and_default_source_locale(self) -> None:
        text = release_form.render_new("4.0.0", "400", "3.0.0", "abc123")

        self.assertIn("schema_version: 8", text)
        self.assertIn("project_type: flutter", text)
        self.assertIn("version_source: pubspec.yaml", text)
        self.assertIn("source_locale: zh-Hans", text)
        self.assertIn("source_locale_label: 简体中文", text)
        self.assertIn("source_copy_status: pending_approval", text)
        self.assertIn("description_status: pending_approval", text)
        self.assertIn(
            "description_policy: translate_selected_scope_then_compare_existing", text
        )
        self.assertIn("existing_content_policy: ask_user_on_difference", text)
        self.assertIn("computer_use_availability: pending_check", text)
        self.assertIn("unlocalized_locale_policy: pending_user_choice", text)
        self.assertIn("localization_scope: pending_user_choice", text)
        self.assertIn("### 描述\n\n```text\nTODO_SOURCE_DESCRIPTION", text)
        self.assertIn("### 关键词\n\n```text\nTODO_SOURCE_KEYWORDS", text)
        self.assertEqual(text.count("- 描述："), len(release_form.ALL_LOCALES))
        self.assertEqual(text.count("- 推广文本："), len(release_form.ALL_LOCALES))
        self.assertEqual(text.count("- 关键词："), len(release_form.ALL_LOCALES))
        self.assertEqual(text.count("- 此版本的新增内容："), len(release_form.ALL_LOCALES))
        localized_count = sum(
            state != "unlocalized_add_required"
            for _, _, state in release_form.ALL_LOCALES
        )
        unlocalized_count = len(release_form.ALL_LOCALES) - localized_count
        for heading in release_form.PUBLIC_COPY_FIELDS:
            self.assertEqual(
                text.count(f"- {heading}页面策略：`pending_page_comparison`"),
                localized_count,
            )
            self.assertEqual(
                text.count(f"- {heading}页面策略：`not_in_scope`"),
                unlocalized_count,
            )

    def test_new_form_accepts_english_as_source_locale(self) -> None:
        text = release_form.render_new(
            "4.0.0", "400", "3.0.0", "abc123", "en-US"
        )

        self.assertIn("source_locale: en-US", text)
        self.assertIn("source_locale_label: 英语（美国）", text)
        source_section = release_form.locale_section(text, "en-US")
        self.assertIsNotNone(source_section)
        self.assertIn("- 状态：`pending_source_approval`", source_section)
        zh_section = release_form.locale_section(text, "zh-Hans")
        self.assertIsNotNone(zh_section)
        self.assertIn(
            "- 状态：`pending_translation_after_source_approval`", zh_section
        )

    def test_new_form_rejects_unknown_source_locale(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported source locale"):
            release_form.render_new(
                "4.0.0", "400", "3.0.0", "abc123", "not-a-locale"
            )

    def test_keywords_reject_limit_format_empty_and_duplicates(self) -> None:
        result = release_form.Result()
        release_form.validate_keywords("a" * 101, "keywords", result)
        release_form.validate_keywords("video，ai", "full-width", result)
        release_form.validate_keywords("video,,ai", "empty", result)
        release_form.validate_keywords("Video,video", "duplicate", result)

        errors = "\n".join(result.errors)
        self.assertIn("limit is 100", errors)
        self.assertIn("ASCII commas only", errors)
        self.assertIn("empty keyword", errors)
        self.assertIn("duplicate keywords", errors)

    def test_existing_locale_description_cannot_be_overwritten(self) -> None:
        text = self._schema_three_text(
            asc_state="localized",
            strategy="preserve_existing",
            description_write="A replacement description",
        )
        result = self._validate_schema_three(text)

        self.assertTrue(
            any("attempts to overwrite an existing description" in error for error in result.errors)
        )

    def test_new_locale_initial_description_is_allowed(self) -> None:
        text = self._schema_three_text(
            asc_state="unlocalized_add_required",
            strategy="initialize_new_locale",
            description_write="A first-use localized description",
        )
        result = self._validate_schema_three(text)

        self.assertEqual(result.errors, [])

    def test_ready_form_requires_all_three_locale_fields(self) -> None:
        text = self._schema_three_text(
            asc_state="localized",
            strategy="preserve_existing",
            description_write="INHERIT_EXISTING_ASC_VALUE",
            include_keywords=False,
        )
        result = self._validate_schema_three(text)

        self.assertIn("locale en-US is missing 关键词", result.errors)

    def test_command_new_writes_current_version_and_build(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / "pubspec.yaml").write_text(
                "name: sample\nversion: 4.1.0+401\n",
                encoding="utf-8",
            )
            args = type(
                "Args",
                (),
                {"repo": str(repo), "force": False, "source_locale": "en-US"},
            )()

            status = release_form.command_new(args)
            created = repo / "docs" / "app-store-connect" / "releases" / "4.1.0.md"

            self.assertEqual(status, 0)
            self.assertTrue(created.exists())
            contents = created.read_text(encoding="utf-8")
            self.assertIn("app_version: 4.1.0", contents)
            self.assertIn("build_number: 401", contents)
            self.assertIn("source_locale: en-US", contents)
            self.assertIn("schema_version: 8", contents)
            self.assertIn("project_type: flutter", contents)
            self.assertIn("description_status: pending_approval", contents)
            self.assertIn("keywords_status: pending_approval", contents)

    def test_pubspec_version_allows_quotes_and_inline_comment(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / "pubspec.yaml").write_text(
                'name: sample\nversion: "1.2.3+123" # release build\n',
                encoding="utf-8",
            )

            version, build = release_form.read_pubspec_version(repo)

            self.assertEqual((version, build), ("1.2.3", "123"))

    def test_explicit_version_overrides_pubspec(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / "pubspec.yaml").write_text(
                "name: sample\nversion: 1.0.0+1\n", encoding="utf-8"
            )
            args = type(
                "Args",
                (),
                {
                    "version": "2.0.0",
                    "build": "20",
                    "project_type": "auto",
                    "workspace": None,
                    "project": None,
                    "scheme": None,
                    "configuration": "Release",
                },
            )()

            resolved = release_form.resolve_project_version(repo, args)

            self.assertEqual((resolved.version, resolved.build), ("2.0.0", "20"))
            self.assertEqual(resolved.project_type, "flutter")
            self.assertEqual(resolved.version_source, "explicit")

    def test_explicit_version_bypasses_invalid_pubspec(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / "pubspec.yaml").write_text("version: invalid\n", encoding="utf-8")
            args = type(
                "Args",
                (),
                {
                    "version": "2.0.0",
                    "build": "20",
                    "project_type": "auto",
                    "workspace": None,
                    "project": None,
                    "scheme": None,
                    "configuration": "Release",
                },
            )()

            resolved = release_form.resolve_project_version(repo, args)

            self.assertEqual((resolved.version, resolved.build), ("2.0.0", "20"))
            self.assertEqual(resolved.project_type, "flutter")

    def test_explicit_version_supports_repository_without_project_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            args = type(
                "Args",
                (),
                {
                    "version": "9.9.9",
                    "build": "999",
                    "project_type": "auto",
                    "workspace": None,
                    "project": None,
                    "scheme": None,
                    "configuration": "Release",
                },
            )()

            resolved = release_form.resolve_project_version(repo, args)

            self.assertEqual(resolved.project_type, "unknown")
            self.assertEqual(resolved.version_source, "explicit")
            form = repo / "explicit.md"
            form.write_text(
                release_form.render_new(
                    "9.9.9",
                    "999",
                    "not_recorded",
                    "abc",
                    project_type="unknown",
                    version_source="explicit",
                ),
                encoding="utf-8",
            )
            self.assertEqual(release_form.validate_form(form, repo).errors, [])

    def test_command_new_rejects_version_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            args = type(
                "Args",
                (),
                {
                    "repo": str(repo),
                    "version": "1/../../escaped",
                    "build": "9",
                    "project_type": "auto",
                    "workspace": None,
                    "project": None,
                    "scheme": None,
                    "configuration": "Release",
                    "source_locale": "en-US",
                    "force": False,
                },
            )()

            status = release_form.command_new(args)

            self.assertEqual(status, 1)
            self.assertFalse((repo / "docs" / "app-store-connect" / "escaped.md").exists())

    def test_explicit_version_and_build_must_be_paired(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            args = type(
                "Args",
                (),
                {
                    "version": "2.0.0",
                    "build": None,
                    "project_type": "auto",
                    "workspace": None,
                    "project": None,
                    "scheme": None,
                    "configuration": "Release",
                },
            )()
            with self.assertRaisesRegex(ValueError, "provided together"):
                release_form.resolve_project_version(Path(temp_dir), args)

    def test_xcode_version_detection_uses_selected_scheme(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / "Sample.xcodeproj").mkdir()
            args = type(
                "Args",
                (),
                {
                    "version": None,
                    "build": None,
                    "project_type": "xcode",
                    "workspace": None,
                    "project": None,
                    "scheme": None,
                    "configuration": "Release",
                },
            )()
            responses = [
                mock.Mock(returncode=0, stdout='{"project":{"schemes":["Sample"]}}', stderr=""),
                mock.Mock(
                    returncode=0,
                    stdout=(
                        '[{"buildSettings":{"PRODUCT_TYPE":'
                        '"com.apple.product-type.application",'
                        '"MARKETING_VERSION":"3.2.1",'
                        '"CURRENT_PROJECT_VERSION":"321"}}]'
                    ),
                    stderr="",
                ),
            ]
            with mock.patch.object(release_form.subprocess, "run", side_effect=responses) as run:
                resolved = release_form.resolve_project_version(repo, args)

            self.assertEqual((resolved.version, resolved.build), ("3.2.1", "321"))
            self.assertEqual(resolved.xcode_scheme, "Sample")
            self.assertEqual(resolved.version_source, "xcodebuild")
            self.assertIn("-showBuildSettings", run.call_args_list[1].args[0])

    def test_multiple_xcode_workspaces_require_explicit_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / "One.xcworkspace").mkdir()
            (repo / "Two.xcworkspace").mkdir()
            with self.assertRaisesRegex(ValueError, "multiple Xcode workspaces"):
                release_form.resolve_xcode_container(repo, None, None)

    def test_multiple_xcode_projects_require_explicit_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            (repo / "One.xcodeproj").mkdir()
            (repo / "Two.xcodeproj").mkdir()
            with self.assertRaisesRegex(ValueError, "multiple Xcode projects"):
                release_form.resolve_xcode_container(repo, None, None)

    def test_internal_project_workspace_is_not_selected_as_user_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            project = repo / "Sample.xcodeproj"
            (project / "project.xcworkspace").mkdir(parents=True)

            kind, selected = release_form.resolve_xcode_container(repo, None, None)

            self.assertEqual(kind, "project")
            self.assertEqual(selected, project)

    def test_multiple_xcode_schemes_require_explicit_selection(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            project = repo / "Sample.xcodeproj"
            project.mkdir()
            response = mock.Mock(
                returncode=0,
                stdout='{"project":{"schemes":["One","Two"]}}',
                stderr="",
            )
            with mock.patch.object(release_form.subprocess, "run", return_value=response):
                with self.assertRaisesRegex(ValueError, "multiple Xcode schemes"):
                    release_form.resolve_xcode_scheme(repo, "project", project, None)

    def test_explicit_xcode_scheme_must_be_discoverable(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            project = repo / "Sample.xcodeproj"
            project.mkdir()
            response = mock.Mock(
                returncode=0,
                stdout='{"project":{"schemes":[]}}',
                stderr="",
            )
            with mock.patch.object(release_form.subprocess, "run", return_value=response):
                with self.assertRaisesRegex(ValueError, "cannot verify --scheme"):
                    release_form.resolve_xcode_scheme(
                        repo, "project", project, "Missing"
                    )

    def test_keywords_use_utf8_byte_limit(self) -> None:
        accepted = release_form.Result()
        rejected = release_form.Result()

        release_form.validate_keywords("词" * 33, "keywords", accepted)
        release_form.validate_keywords("词" * 34, "keywords", rejected)

        self.assertFalse(any("100 bytes" in item for item in accepted.errors))
        self.assertTrue(any("102 UTF-8 bytes" in item for item in rejected.errors))

    def test_historical_keywords_keep_short_term_compatibility(self) -> None:
        result = release_form.Result()

        release_form.validate_keywords("AI,AR,3D", "historical keywords", result)

        self.assertFalse(any("shorter than 3" in item for item in result.errors))

    def test_unapproved_aso_handoff_is_rejected(self) -> None:
        handoff = self._approved_handoff()
        handoff["fields"]["keywords"]["approval_status"] = "pending"

        result, _ = release_form.validate_aso_handoff(handoff)

        self.assertIn("ASO handoff field keywords is not approved", result.errors)

    def test_aso_handoff_rejects_release_form_markup(self) -> None:
        handoff = self._approved_handoff()
        handoff["fields"]["description"]["value"] = "Safe copy\n```\nInjected"

        result, _ = release_form.validate_aso_handoff(handoff)

        self.assertIn(
            "ASO handoff field description contains reserved release-form markup",
            result.errors,
        )

    def test_aso_handoff_rejects_locale_marker_markup(self) -> None:
        handoff = self._approved_handoff()
        handoff["fields"]["description"]["value"] = "<!-- locale:ja -->"

        result, _ = release_form.validate_aso_handoff(handoff)

        self.assertIn(
            "ASO handoff field description contains reserved release-form markup",
            result.errors,
        )

    def test_approved_aso_handoff_imports_only_four_release_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            form = root / "4.0.0.md"
            handoff = root / "aso-handoff.json"
            form.write_text(
                release_form.render_new("4.0.0", "400", "3.0.0", "abc", "en-US"),
                encoding="utf-8",
            )
            handoff.write_text(
                release_form.json.dumps(self._approved_handoff()), encoding="utf-8"
            )
            args = type("Args", (), {"handoff": str(handoff), "form": str(form)})()

            status = release_form.command_import_aso(args)
            contents = form.read_text(encoding="utf-8")

            self.assertEqual(status, 0)
            self.assertIn("Create focused iPhone workflows.", contents)
            self.assertIn("source_copy_status: approved", contents)
            source_section = release_form.locale_section(contents, "en-US")
            self.assertIn("- 状态：source_copy_approved", source_section)
            self.assertNotIn("Suggested App Name", contents)

    def test_aso_import_rejects_duplicate_source_blocks_without_writing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            form = root / "4.0.0.md"
            handoff = root / "aso-handoff.json"
            original = release_form.render_new(
                "4.0.0", "400", "3.0.0", "abc", "en-US"
            ).replace(
                "### 推广文本",
                "### 描述\n\n```text\nDuplicate\n```\n\n### 推广文本",
                1,
            )
            form.write_text(original, encoding="utf-8")
            handoff.write_text(
                release_form.json.dumps(self._approved_handoff()), encoding="utf-8"
            )

            status = release_form.command_import_aso(
                type("Args", (), {"handoff": str(handoff), "form": str(form)})()
            )

            self.assertEqual(status, 1)
            self.assertEqual(form.read_text(encoding="utf-8"), original)

    def test_aso_import_rejects_invalid_form_schema_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            form = root / "invalid.md"
            handoff = root / "aso-handoff.json"
            form.write_text("---\nschema_version: invalid\n---\n", encoding="utf-8")
            handoff.write_text(
                release_form.json.dumps(self._approved_handoff()), encoding="utf-8"
            )

            status = release_form.command_import_aso(
                type("Args", (), {"handoff": str(handoff), "form": str(form)})()
            )

            self.assertEqual(status, 1)
            self.assertEqual(
                form.read_text(encoding="utf-8"),
                "---\nschema_version: invalid\n---\n",
            )

    def test_summary_accepts_schema_seven_and_eight_copy_statuses(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Path(temp_dir)
            releases = repo / "docs" / "app-store-connect" / "releases"
            releases.mkdir(parents=True)
            common = """app_version: {version}\nbuild_number: 1\nform_status: draft\nlocalization_status: pending\nbuild_binding_status: unbound\nreview_status: not_added_for_review\n"""
            (releases / "1.0.0.md").write_text(
                "---\nschema_version: 7\nchinese_copy_status: approved\n"
                + common.format(version="1.0.0")
                + "---\n",
                encoding="utf-8",
            )
            (releases / "2.0.0.md").write_text(
                "---\nschema_version: 8\nsource_copy_status: approved\n"
                + common.format(version="2.0.0")
                + "---\n",
                encoding="utf-8",
            )
            output = StringIO()
            with redirect_stdout(output):
                status = release_form.command_summary(
                    type("Args", (), {"repo": str(repo)})()
                )

            self.assertEqual(status, 0)
            self.assertEqual(output.getvalue().count("approved"), 2)

    def _approved_handoff(self) -> dict:
        return {
            "schema_version": 1,
            "source_locale": "en-US",
            "generated_at": "2026-08-14T12:00:00Z",
            "approval_status": "approved",
            "sources": ["https://developer.apple.com/help/app-store-connect/"],
            "fields": {
                "description": {
                    "value": "Create focused iPhone workflows.",
                    "approval_status": "approved",
                },
                "promotional_text": {
                    "value": "Build better iOS apps.",
                    "approval_status": "approved",
                },
                "keywords": {
                    "value": "ios,swiftui,developer",
                    "approval_status": "approved",
                },
                "whats_new": {
                    "value": "Improved reliability.",
                    "approval_status": "approved",
                },
            },
            "app_information_recommendations": {
                "name": "Suggested App Name",
                "subtitle": "Suggested Subtitle",
            },
        }

    def _historical_form(self, schema: int) -> str:
        locales = (
            release_form.LEGACY_LOCALE_IDS
            if schema == 1
            else release_form.ALL_LOCALE_IDS
        )
        inventory = ""
        if schema == 2:
            inventory = (
                "localization_scope: app_store_connect_all_languages\n"
                "locale_inventory_source: historical_test\n"
                f"locale_inventory: {release_form.ALL_LOCALE_INVENTORY}\n"
            )
        markers = "\n".join(f"<!-- locale:{locale} -->" for locale in locales)
        return f"""---
schema_version: {schema}
app_version: {schema}.0.0
build_number: {schema}
previous_version: not_recorded
source_commit: not_recorded
form_status: historical_published
chinese_copy_status: approved
localization_status: saved_and_read_back
build_processing_status: processed
build_binding_status: bound
review_status: submitted
{inventory}---
{markers}
"""

    def test_schema_one_historical_form_remains_readable(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "1.0.0.md"
            path.write_text(self._historical_form(1), encoding="utf-8")

            result = release_form.validate_form(path, None)

            self.assertEqual(result.errors, [])

    def test_schema_two_historical_form_remains_readable(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "2.0.0.md"
            path.write_text(self._historical_form(2), encoding="utf-8")

            result = release_form.validate_form(path, None)

            self.assertEqual(result.errors, [])

    def test_schema_eight_draft_validates_without_migration(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "4.0.0.md"
            text = release_form.render_new("4.0.0", "400", "3.0.0", "abc")
            path.write_text(text, encoding="utf-8")

            result = release_form.validate_form(path, None)

            self.assertEqual(result.errors, [])
            self.assertEqual(release_form.read_frontmatter(text)["schema_version"], "8")

    def test_unknown_future_schema_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "4.0.0.md"
            text = release_form.render_new("4.0.0", "400", "3.0.0", "abc").replace(
                "schema_version: 8", "schema_version: 999", 1
            )
            path.write_text(text, encoding="utf-8")

            result = release_form.validate_form(path, None)

            self.assertIn(
                "unsupported schema_version: 999; supported versions are 1 through 8",
                result.errors,
            )

    def test_schema_five_accepts_non_chinese_source(self) -> None:
        text = self._schema_five_text()
        result = self._validate_schema_five(text)

        self.assertEqual(result.errors, [])

    def test_schema_five_rejects_source_locale_copy_drift(self) -> None:
        text = self._schema_five_text().replace(
            "- 描述：Create AI videos from your ideas.",
            "- 描述：Changed after approval.",
        )
        result = self._validate_schema_five(text)

        self.assertIn(
            "source locale en-US 描述 must exactly match its approved source block",
            result.errors,
        )

    def test_schema_five_rejects_source_outside_inventory(self) -> None:
        text = self._schema_five_text().replace(
            "source_locale: en-US", "source_locale: ja"
        ).replace("source_locale_label: 英语（美国）", "source_locale_label: 日语")
        result = self._validate_schema_five(text)

        self.assertIn("source_locale ja is not declared in locale_inventory", result.errors)

    def test_schema_six_allows_confirmed_inheritance_with_translation_retained(self) -> None:
        text = self._schema_six_text(
            description_strategy="inherit_after_user_confirmation"
        )
        result = self._validate_schema_six(text)

        self.assertEqual(result.errors, [])

    def test_schema_six_allows_confirmed_replacement(self) -> None:
        text = self._schema_six_text(
            description_strategy="replace_after_user_confirmation"
        )
        result = self._validate_schema_six(text)

        self.assertEqual(result.errors, [])

    def test_schema_six_requires_comparison_before_readback_complete(self) -> None:
        text = self._schema_six_text(
            description_strategy="pending_page_comparison"
        )
        result = self._validate_schema_six(text)

        self.assertIn(
            "locale en-US 描述 still awaits page comparison", result.errors
        )

    def test_schema_six_unlocalized_locale_cannot_inherit(self) -> None:
        text = self._schema_six_text(
            description_strategy="inherit_after_user_confirmation",
            asc_state="unlocalized_add_required",
        )
        result = self._validate_schema_six(text)

        self.assertIn(
            "locale en-US cannot inherit 描述 before localization creation",
            result.errors,
        )

    def test_schema_seven_localized_only_accepts_excluded_unlocalized_locale(self) -> None:
        text = self._schema_seven_text()
        result = self._validate_schema_seven(text)

        self.assertEqual(result.errors, [])

    def test_schema_seven_ready_requires_scope_choice(self) -> None:
        text = self._schema_seven_text().replace(
            "localization_scope: app_store_connect_localized_languages",
            "localization_scope: pending_user_choice",
        ).replace(
            "unlocalized_locale_policy: exclude_after_user_confirmation",
            "unlocalized_locale_policy: pending_user_choice",
        )
        result = self._validate_schema_seven(text)

        self.assertIn(
            "ready-to-fill requires an explicit localization_scope choice",
            result.errors,
        )

    def test_schema_seven_ready_requires_computer_use_check(self) -> None:
        text = self._schema_seven_text().replace(
            "computer_use_availability: available",
            "computer_use_availability: pending_check",
        )
        result = self._validate_schema_seven(text)

        self.assertIn(
            "ready-to-fill requires a current Computer Use availability check",
            result.errors,
        )

    def test_schema_seven_all_language_scope_rejects_untranslated_locale(self) -> None:
        text = self._schema_seven_text().replace(
            "localization_scope: app_store_connect_localized_languages",
            "localization_scope: app_store_connect_all_languages",
        ).replace(
            "unlocalized_locale_policy: exclude_after_user_confirmation",
            "unlocalized_locale_policy: include_after_user_confirmation",
        )
        result = self._validate_schema_seven(text)

        self.assertIn("locale or still has a 描述 placeholder", result.errors)

    def test_schema_four_requires_translated_description_for_existing_locale(self) -> None:
        text = self._schema_four_text(description="INHERIT_EXISTING_ASC_VALUE")
        result = self._validate_schema_four(text)

        self.assertIn(
            "locale en-US must translate and replace its description",
            result.errors,
        )

    def test_schema_four_accepts_all_four_translated_fields(self) -> None:
        text = self._schema_four_text(description="Create AI videos from your ideas.")
        result = self._validate_schema_four(text)

        self.assertEqual(result.errors, [])

    def test_schema_four_requires_description_approval(self) -> None:
        text = self._schema_four_text(
            description="Create AI videos from your ideas.",
            description_status="pending_approval",
        )
        result = self._validate_schema_four(text)

        self.assertTrue(
            any("all four Chinese copy statuses" in error for error in result.errors)
        )

    def _schema_three_text(
        self,
        *,
        asc_state: str,
        strategy: str,
        description_write: str,
        include_keywords: bool = True,
    ) -> str:
        keyword_line = "- 关键词：video,art,creator\n" if include_keywords else ""
        return f"""---
schema_version: 3
form_status: ready-to-fill
chinese_copy_status: approved
promotional_text_status: approved
keywords_status: approved
whats_new_status: approved
description_policy: preserve_existing_except_new_locale_initialization
new_locale_description_status: approved
---

### 关键词

```text
视频工具,人工智能,创作工具
```

### 新语言初始化描述

```text
用于创建新语言的稳定描述
```

<!-- locale:en-US -->
### en-US — English

- App Store Connect 清单状态：`{asc_state}`
- 状态：`ready_to_fill`
- 描述策略：`{strategy}`
- 描述写入：`{description_write}`
- 推广文本：Create AI videos.
{keyword_line}- 此版本的新增内容：Improved creation and stability.
"""

    def _validate_schema_three(self, text: str):
        result = release_form.Result()
        release_form.validate_schema_three(
            text,
            release_form.read_frontmatter(text),
            ("en-US",),
            False,
            result,
        )
        return result

    def _schema_four_text(
        self,
        *,
        description: str,
        description_status: str = "approved",
    ) -> str:
        return f"""---
schema_version: 4
form_status: ready-to-fill
chinese_copy_status: approved
description_status: {description_status}
promotional_text_status: approved
keywords_status: approved
whats_new_status: approved
description_policy: translate_all_locales
---

### 描述

```text
用创意生成 AI 视频。
```

### 关键词

```text
视频工具,人工智能,创作工具
```

<!-- locale:en-US -->
### en-US — English

- App Store Connect 清单状态：`localized`
- 状态：`ready_to_fill`
- 描述策略：`translate_and_replace`
- 描述：{description}
- 推广文本：Create AI videos.
- 关键词：video,art,creator
- 此版本的新增内容：Improved creation and stability.
"""

    def _validate_schema_four(self, text: str):
        result = release_form.Result()
        release_form.validate_schema_four(
            text,
            release_form.read_frontmatter(text),
            ("en-US",),
            False,
            result,
        )
        return result

    def _schema_five_text(self) -> str:
        return """---
schema_version: 5
form_status: ready-to-fill
source_locale: en-US
source_locale_label: 英语（美国）
source_copy_status: approved
description_status: approved
promotional_text_status: approved
keywords_status: approved
whats_new_status: approved
description_policy: translate_all_locales
---

### 描述

```text
Create AI videos from your ideas.
```

### 推广文本

```text
Create AI videos.
```

### 关键词

```text
video,art,creator
```

### 此版本的新增内容

```text
Improved creation and stability.
```

<!-- locale:en-US -->
### en-US — English

- App Store Connect 清单状态：`localized`
- 状态：`ready_to_fill`
- 描述策略：`translate_and_replace`
- 描述：Create AI videos from your ideas.
- 推广文本：Create AI videos.
- 关键词：video,art,creator
- 此版本的新增内容：Improved creation and stability.
"""

    def _validate_schema_five(self, text: str):
        result = release_form.Result()
        release_form.validate_schema_five(
            text,
            release_form.read_frontmatter(text),
            ("en-US",),
            False,
            result,
        )
        return result

    def _schema_six_text(
        self,
        *,
        description_strategy: str,
        asc_state: str = "localized",
    ) -> str:
        return f"""---
schema_version: 6
form_status: ready-to-fill
source_locale: en-US
source_locale_label: 英语（美国）
source_copy_status: approved
description_status: approved
promotional_text_status: approved
keywords_status: approved
whats_new_status: approved
description_policy: translate_all_then_compare_existing
existing_content_policy: ask_user_on_difference
localization_status: saved_and_read_back
---

### 描述

```text
Create AI videos from your ideas.
```

### 推广文本

```text
Create AI videos.
```

### 关键词

```text
video,art,creator
```

### 此版本的新增内容

```text
Improved creation and stability.
```

<!-- locale:en-US -->
### en-US — English

- App Store Connect 清单状态：`{asc_state}`
- 状态：`saved_and_read_back`
- 描述页面策略：`{description_strategy}`
- 描述：Create AI videos from your ideas.
- 推广文本页面策略：`matches_translation`
- 推广文本：Create AI videos.
- 关键词页面策略：`matches_translation`
- 关键词：video,art,creator
- 此版本的新增内容页面策略：`matches_translation`
- 此版本的新增内容：Improved creation and stability.
"""

    def _validate_schema_six(self, text: str):
        result = release_form.Result()
        release_form.validate_schema_six(
            text,
            release_form.read_frontmatter(text),
            ("en-US",),
            False,
            result,
        )
        return result

    def _schema_seven_text(self) -> str:
        return """---
schema_version: 7
form_status: ready-to-fill
source_locale: en-US
source_locale_label: 英语（美国）
source_copy_status: approved
description_status: approved
promotional_text_status: approved
keywords_status: approved
whats_new_status: approved
description_policy: translate_selected_scope_then_compare_existing
existing_content_policy: ask_user_on_difference
computer_use_availability: available
unlocalized_locale_policy: exclude_after_user_confirmation
localization_scope: app_store_connect_localized_languages
localization_status: saved_and_read_back
---

### 描述

```text
Create AI videos from your ideas.
```

### 推广文本

```text
Create AI videos.
```

### 关键词

```text
video,art,creator
```

### 此版本的新增内容

```text
Improved creation and stability.
```

<!-- locale:en-US -->
### en-US — English

- App Store Connect 清单状态：`localized`
- 状态：`saved_and_read_back`
- 描述页面策略：`matches_translation`
- 描述：Create AI videos from your ideas.
- 推广文本页面策略：`matches_translation`
- 推广文本：Create AI videos.
- 关键词页面策略：`matches_translation`
- 关键词：video,art,creator
- 此版本的新增内容页面策略：`matches_translation`
- 此版本的新增内容：Improved creation and stability.

<!-- locale:or -->
### or — 奥里亚语

- App Store Connect 清单状态：`unlocalized_add_required`
- 状态：`not_requested_by_user`
- 描述页面策略：`not_in_scope`
- 描述：`TODO_AFTER_SCOPE_CHOICE`
- 推广文本页面策略：`not_in_scope`
- 推广文本：`TODO_AFTER_SCOPE_CHOICE`
- 关键词页面策略：`not_in_scope`
- 关键词：`TODO_AFTER_SCOPE_CHOICE`
- 此版本的新增内容页面策略：`not_in_scope`
- 此版本的新增内容：`TODO_AFTER_SCOPE_CHOICE`
"""

    def _validate_schema_seven(self, text: str):
        result = release_form.Result()
        release_form.validate_schema_seven(
            text,
            release_form.read_frontmatter(text),
            ("en-US", "or"),
            False,
            result,
        )
        return result


if __name__ == "__main__":
    unittest.main()
