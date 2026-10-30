#!/usr/bin/env python3
"""Validate Schema v1 fixtures, references, and regression coverage."""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

try:
    from jsonschema import Draft202012Validator
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit(
        "Project validation requires Python package 'jsonschema'."
    ) from exc


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = PROJECT_ROOT / "schemas" / "conversation-document.schema.json"
FIXTURE_DIR = PROJECT_ROOT / "fixtures"
GOOD_FIXTURES = ("basic", "basic-en", "rich", "long", "story", "story-en")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def duplicates(values: list[str]) -> list[str]:
    counts = Counter(values)
    return sorted(value for value, count in counts.items() if count > 1)


def semantic_errors(document: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    messages = document.get("messages", [])
    assets = document.get("assets", [])

    message_ids = [message.get("id") for message in messages if message.get("id")]
    for value in duplicates(message_ids):
        errors.append(f"duplicate message id: {value}")

    blocks = [
        block
        for message in messages
        for block in message.get("blocks", [])
        if isinstance(block, dict)
    ]
    block_ids = [block.get("id") for block in blocks if block.get("id")]
    for value in duplicates(block_ids):
        errors.append(f"duplicate block id: {value}")

    asset_ids = [asset.get("id") for asset in assets if asset.get("id")]
    for value in duplicates(asset_ids):
        errors.append(f"duplicate asset id: {value}")

    assets_by_id = {
        asset["id"]: asset
        for asset in assets
        if isinstance(asset, dict) and isinstance(asset.get("id"), str)
    }

    for block in blocks:
        block_type = block.get("type")
        if block_type not in {"image", "file"}:
            continue
        asset_id = block.get("assetId")
        asset = assets_by_id.get(asset_id)
        if asset is None:
            errors.append(f"missing asset reference: {asset_id}")
            continue
        expected_kind = "image" if block_type == "image" else "file"
        if asset.get("kind") != expected_kind:
            errors.append(
                f"asset kind mismatch: {asset_id} is {asset.get('kind')}, "
                f"expected {expected_kind}"
            )

    tool_call_ids = {
        block.get("callId") for block in blocks if block.get("type") == "toolCall"
    }
    for block in blocks:
        if block.get("type") == "toolResult" and block.get("callId") not in tool_call_ids:
            errors.append(f"orphan tool result: {block.get('callId')}")

    for asset in assets:
        source = asset.get("source", {})
        if source.get("kind") != "fixture":
            continue
        relative_path = source.get("path", "")
        path = Path(relative_path)
        if path.is_absolute() or ".." in path.parts:
            errors.append(f"unsafe fixture path: {relative_path}")
            continue
        absolute_path = PROJECT_ROOT / path
        if not absolute_path.is_file():
            errors.append(f"missing fixture file: {relative_path}")
            continue
        expected_size = asset.get("byteSize")
        if expected_size is not None and absolute_path.stat().st_size != expected_size:
            errors.append(
                f"fixture byteSize mismatch: {relative_path} is "
                f"{absolute_path.stat().st_size}, expected {expected_size}"
            )

    return errors


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def validate_coverage(documents: dict[str, dict[str, Any]]) -> None:
    rich = documents["rich"]
    rich_messages = rich["messages"]
    rich_blocks = [block for message in rich_messages for block in message["blocks"]]

    require(
        {"user", "assistant", "system", "developer", "tool", "unknown"}
        <= {message["role"] for message in rich_messages},
        "rich fixture does not cover all planned roles",
    )
    require(
        {
            "markdown",
            "image",
            "file",
            "reasoning",
            "toolCall",
            "toolResult",
            "unsupported",
        }
        <= {block["type"] for block in rich_blocks},
        "rich fixture does not cover every Schema v1 block type",
    )
    require(
        {"neutral", "pending", "running", "success", "error"}
        <= {block["status"] for block in rich_blocks if "status" in block},
        "rich fixture does not cover all execution states",
    )
    require(
        {"collapsed", "expanded"}
        <= {block["displayState"] for block in rich_blocks if "displayState" in block},
        "rich fixture does not cover both display states",
    )
    require(
        {"current", "collapsed", "expanded"}
        <= {block["exportState"] for block in rich_blocks if "exportState" in block},
        "rich fixture does not cover all export states",
    )

    long_document = documents["long"]
    long_blocks = [
        block for message in long_document["messages"] for block in message["blocks"]
    ]
    require(len(long_document["messages"]) >= 20, "long fixture needs at least 20 messages")
    require(
        sum(block["type"] == "image" for block in long_blocks) >= 3,
        "long fixture needs at least three image blocks",
    )
    markdown_source = "\n".join(
        block["source"] for block in long_blocks if block["type"] == "markdown"
    )
    for marker in ("```", "$$", "| 内容类型 |"):
        require(marker in markdown_source, f"long fixture is missing marker: {marker}")


def main() -> int:
    schema = load_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)

    documents: dict[str, dict[str, Any]] = {}
    for fixture_name in GOOD_FIXTURES:
        path = FIXTURE_DIR / f"{fixture_name}.fixture.json"
        document = load_json(path)
        structural_errors = sorted(
            validator.iter_errors(document), key=lambda error: list(error.absolute_path)
        )
        require(
            not structural_errors,
            f"{path.name} failed Schema v1: "
            + "; ".join(error.message for error in structural_errors),
        )
        errors = semantic_errors(document)
        require(not errors, f"{path.name} failed semantic checks: {'; '.join(errors)}")
        documents[fixture_name] = document

    broken_path = FIXTURE_DIR / "broken.fixture.json"
    broken = load_json(broken_path)
    broken_schema_errors = list(validator.iter_errors(broken))
    broken_semantic_errors = semantic_errors(broken)
    require(broken_schema_errors, "broken.fixture.json unexpectedly passed Schema v1")
    require(
        len(broken_semantic_errors) >= 4,
        "broken.fixture.json did not exercise enough semantic failures",
    )

    validate_coverage(documents)

    print("Project validation passed")
    print("  Schema: Draft 2020-12 valid")
    print("  Valid fixtures: " + ", ".join(GOOD_FIXTURES))
    print(
        "  Broken fixture: "
        f"{len(broken_schema_errors)} structural and "
        f"{len(broken_semantic_errors)} semantic errors detected as expected"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, json.JSONDecodeError) as error:
        print(f"Project validation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
