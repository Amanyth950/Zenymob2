#!/usr/bin/env python3
"""Convert legacy monster_ev.csv rows into Zenymob2 frontend JSON.

Usage:
    python scripts/convert_monster_ev_csv.py monster_ev.csv public/data/monsters.json

The converter expects the Streamlit-era CSV to contain drops_json and spawn_summary.
It is intentionally tolerant so the frontend data contract can be tested before the
old generator is rewritten directly.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import Any


def as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_bool(value: Any) -> bool:
    return str(value or "").strip().lower() in {"true", "1", "yes"}


def parse_spawns(summary: str) -> list[dict[str, Any]]:
    spawns: list[dict[str, Any]] = []
    for piece in str(summary or "").split(";"):
        part = piece.strip()
        if not part or ":" not in part:
            continue
        map_name, count = part.rsplit(":", 1)
        map_name = map_name.strip()
        amount = as_int(count, 0)
        if map_name and amount > 0:
            spawns.append({"map": map_name, "count": amount})
    return spawns


def parse_drops(raw: str) -> list[dict[str, Any]]:
    try:
        source = json.loads(raw or "[]")
    except json.JSONDecodeError:
        source = []
    drops: list[dict[str, Any]] = []
    for drop in source if isinstance(source, list) else []:
        if not isinstance(drop, dict):
            continue
        drops.append(
            {
                "itemId": as_int(drop.get("item_id"), 0) or None,
                "itemKey": str(drop.get("aegis_name") or drop.get("name") or ""),
                "name": str(drop.get("name") or drop.get("aegis_name") or ""),
                "chance": as_float(drop.get("raw_chance"), 0.0),
                "baseSellPrice": as_float(drop.get("base_sell_price", drop.get("sell_price")), 0.0),
                "ignoreOvercharge": bool(drop.get("ignore_overcharge")),
                "type": "mvp" if bool(drop.get("is_mvp_drop")) else "normal",
            }
        )
    return drops


def convert(input_path: Path, output_path: Path) -> None:
    monsters = []
    with input_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            monsters.append(
                {
                    "id": as_int(row.get("id")),
                    "name": row.get("name") or row.get("sprite_name") or "Unknown",
                    "level": as_int(row.get("level")),
                    "hp": as_int(row.get("hp")),
                    "element": str(row.get("element_display") or row.get("element") or ""),
                    "race": str(row.get("race") or ""),
                    "size": str(row.get("size") or ""),
                    "isBoss": parse_bool(row.get("is_boss")),
                    "hasMvpDrops": parse_bool(row.get("has_mvp_drops")) or as_int(row.get("mvp_drop_count"), 0) > 0,
                    "spawns": parse_spawns(row.get("spawn_summary", "")),
                    "drops": parse_drops(row.get("drops_json", "")),
                }
            )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(monsters, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(monsters):,} monsters to {output_path}")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python scripts/convert_monster_ev_csv.py monster_ev.csv public/data/monsters.json")
    convert(Path(sys.argv[1]), Path(sys.argv[2]))


if __name__ == "__main__":
    main()
