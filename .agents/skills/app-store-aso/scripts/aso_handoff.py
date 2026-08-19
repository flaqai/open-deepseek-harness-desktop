#!/usr/bin/env python3
"""Create and finalize an Apple App Store ASO handoff file."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys


FIELD_LIMITS = {
    "description": (4000, "characters"),
    "promotional_text": (170, "characters"),
    "keywords": (100, "UTF-8 bytes"),
    "whats_new": (4000, "characters"),
}


def template(source_locale: str) -> dict:
    return {
        "schema_version": 1,
        "source_locale": source_locale,
        "generated_at": None,
        "approval_status": "pending",
        "sources": [],
        "fields": {
            key: {"value": "", "approval_status": "pending"}
            for key in FIELD_LIMITS
        },
        "app_information_recommendations": {"name": "", "subtitle": ""},
    }


def validate(data: object) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["handoff must be a JSON object"]
    if data.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if not isinstance(data.get("source_locale"), str) or not data["source_locale"]:
        errors.append("source_locale is required")
    sources = data.get("sources")
    if not isinstance(sources, list) or not sources or not all(
        isinstance(item, str) and item.startswith(("https://", "http://"))
        for item in sources
    ):
        errors.append("sources must contain at least one HTTP(S) URL")
    fields = data.get("fields")
    if not isinstance(fields, dict):
        return errors + ["fields must be an object"]
    for key, (limit, unit) in FIELD_LIMITS.items():
        value = fields.get(key)
        if not isinstance(value, dict):
            errors.append(f"missing field: {key}")
            continue
        if value.get("approval_status") != "approved":
            errors.append(f"{key} approval_status must be approved")
        text = value.get("value")
        if not isinstance(text, str) or not text.strip():
            errors.append(f"{key} value is required")
            continue
        if re.search(r"(?m)^ {0,3}`{3,}[ \t]*$", text) or "<!-- locale:" in text:
            errors.append(f"{key} contains reserved release-form markup")
        length = len(text.encode("utf-8")) if key == "keywords" else len(text)
        if length > limit:
            errors.append(f"{key} is {length} {unit}; limit is {limit}")
        if key == "keywords":
            if any(separator in text for separator in ("，", "、", ";", "；", "\n", "\r")):
                errors.append("keywords must use ASCII commas only")
            terms = [term.strip().casefold() for term in text.split(",")]
            if any(not term for term in terms):
                errors.append("keywords contain an empty term")
            if len(terms) != len(set(terms)):
                errors.append("keywords contain a duplicate term")
            if any(term and len(term) <= 2 for term in terms):
                errors.append("each keyword must be at least 3 characters")
    return errors


def command_new(args: argparse.Namespace) -> int:
    path = Path(args.output).expanduser().resolve()
    if path.exists() and not args.force:
        print(f"Refusing to overwrite existing file: {path}", file=sys.stderr)
        return 1
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(template(args.source_locale), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(path)
    return 0


def command_finalize(args: argparse.Namespace) -> int:
    path = Path(args.path).expanduser().resolve()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"Unable to read handoff: {error}", file=sys.stderr)
        return 1
    errors = validate(data)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print("Handoff remains unapproved.", file=sys.stderr)
        return 1
    data["approval_status"] = "approved"
    data["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(path)
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)
    new = commands.add_parser("new")
    new.add_argument("--source-locale", required=True)
    new.add_argument("--output", required=True)
    new.add_argument("--force", action="store_true")
    new.set_defaults(func=command_new)
    finalize = commands.add_parser("finalize")
    finalize.add_argument("path")
    finalize.set_defaults(func=command_finalize)
    return result


def main() -> int:
    args = parser().parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
