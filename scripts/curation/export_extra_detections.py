#!/usr/bin/env python3
"""Curated stores outside the 930-store scan get their detection row from our own crawl.

Reads data/curation/stores.json and .data/crawl/scans.json (npm run crawl -- --domains ...) and
writes data/seed/detections-extra.json in the detections-930.json shape. Only Shopify stores the
crawler could read (robots.txt allowed, HTTP < 400) are written; others are reported and skipped.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
base = {d["domain"] for d in json.loads((ROOT / "data/seed/detections-930.json").read_text())}
cur = json.loads((ROOT / "data/curation/stores.json").read_text())["stores"]
scans = {o["scan"]["domain"]: o for o in json.loads((ROOT / ".data/crawl/scans.json").read_text())}
out, missing = [], []
for s in cur:
    d = s["domain"]
    if d in base:
        continue
    o = scans.get(d)
    sc = o and o["scan"]
    platform = (sc or {}).get("platform") or ""
    if not sc or not str(platform).startswith("shopify") or (sc.get("http_status") or 200) >= 500 or o.get("note"):
        missing.append(d)
        continue
    t = sc.get("theme") or {}
    out.append({
        "domain": d,
        "theme": t.get("name"),
        "theme_custom": bool(t.get("is_custom")),
        "apps": sorted({a["slug"] for a in sc.get("apps") or []}),
        "currency": sc.get("currency"),
        "detected_at": sc["scanned_at"],
    })
out.sort(key=lambda x: x["domain"])
(ROOT / "data/seed/detections-extra.json").write_text(json.dumps(out, indent=2) + "\n")
print(f"wrote {len(out)} extra detections; not crawlable/skipped: {missing}")
