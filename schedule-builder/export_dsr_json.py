"""Export the DSR SQLite database to a JSON snapshot the Node backend loads.

Run this whenever `dsr_database.db` is rebuilt (Phase 1) to refresh the app data:

    python3 export_dsr_json.py

Output: backend/data/dsr_items.json

Each item is normalised to:
    {code, description, unit, rate, volume, source_page, carriage, rate_options}

- Normal items:   rate = numeric string (e.g. "2434.25"),  carriage = false
- Carriage items: rate = null, carriage = true, rate_options = {lead: value, ...}
  (these have per-distance/per-lead columns, not a single rate, so the app must
  never auto-fill one rate for them — the user picks the applicable lead.)
"""
import sqlite3
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "dsr_database.db")
OUT = os.path.join(HERE, "backend", "data", "dsr_items.json")


def main():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT code, description, unit, rate, volume, source_page FROM dsr_items"
    ).fetchall()
    conn.close()

    items = []
    carriage = 0
    for r in rows:
        rate_raw = (r["rate"] or "").strip()
        item = {
            "code": r["code"],
            "description": r["description"] or "",
            "unit": r["unit"] or "",
            "volume": r["volume"],
            "source_page": r["source_page"],
            "carriage": False,
            "rate": None,
            "rate_options": None,
        }
        if rate_raw.startswith("{"):
            item["carriage"] = True
            try:
                item["rate_options"] = json.loads(rate_raw)
            except json.JSONDecodeError:
                item["rate_options"] = {}
            carriage += 1
        else:
            item["rate"] = rate_raw
        items.append(item)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(
            {"count": len(items), "carriage_count": carriage, "items": items},
            f,
            ensure_ascii=False,
        )
    print(f"Wrote {len(items)} items ({carriage} carriage) -> {OUT}")


if __name__ == "__main__":
    main()
