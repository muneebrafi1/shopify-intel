"""One-off export of seed data from the StorePeek box data (run on the box, not in CI)."""
import json, csv, re, collections, pathlib
SP = pathlib.Path("/workspace/extensions/storepeek")
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "seed"
L = lambda p: json.load(open(SP / p))
scan = [s for s in L("site/data/scan-raw.json") if s.get("platform") == "shopify"]
appstore = L("site/data/appstore.json")
stats = L("site/data/stats.json")
sig = {a["slug"]: a for a in L("src/data/signatures.json")["apps"]}
themes_db = L("src/data/themes.json")["themes"]
prem = L("src/data/premium-themes.json")["themes"]
aff = L("src/data/affiliates.json")
saff = L("site/data/site-affiliates.json")
cats = L("site/data/appstore-categories.json")

# tranco rank for popularity ordering
rank = {}
import sys
with open(SP / "site/dataset/top-1m.csv") as f:
    for r, d in csv.reader(f):
        rank[d] = int(r)
def trank(h):
    h = h.lower().removeprefix("www.")
    return rank.get(h) or rank.get("www." + h)

def handle_of(slug):
    s = sig.get(slug, {}); m = re.search(r"apps\.shopify\.com/([^/?#]+)", s.get("listing") or "")
    return m.group(1) if m else None

def app_aff(slug, handle):
    for key in (handle, slug):
        if key and key in saff and isinstance(saff[key], dict) and saff[key].get("url"):
            return {"url": saff[key]["url"], "program": saff[key].get("program")}
        a = aff["apps"].get(key) if key else None
        if a and a.get("affiliate"):
            return {"url": a["affiliate"], "program": a.get("program")}
    return None

# ---- apps: top 50 by detections that have App Store data
ranked = sorted(stats["apps"].items(), key=lambda kv: -kv[1]["stores"])
apps = []
for slug, st in ranked:
    h = handle_of(slug)
    if not h or h not in appstore: continue
    a = appstore[h]; s = sig[slug]
    apps.append({
        "slug": slug, "app_store_handle": h, "name": a.get("name") or s["name"],
        "developer": a.get("developer") or s.get("vendor"), "category": s.get("category"),
        "tagline": a.get("tagline") or s.get("description"), "rating": a.get("rating"),
        "reviews": a.get("reviews"), "icon_url": a.get("icon"), "app_store_url": a.get("url"),
        "launched": a.get("launched"), "built_for_shopify": a.get("bfs"),
        "app_store_category": a.get("category"), "plans": a.get("plans"),
        "free_plan": a.get("free_plan"), "from_price": a.get("from_price"), "trial_days": a.get("trial_days"), "features": a.get("features"),
        "works_with": a.get("works_with"), "languages": a.get("languages"),
        "app_store_checked_on": a.get("checked_on"),
        "scan": {"stores": st["stores"], "pct_of_scanned": st["pct"],
                 "co_installed": [c["slug"] for c in st.get("co", [])][:8]},
        "affiliate": app_aff(slug, h),
    })
    if len(apps) == 50: break
APPS = {a["slug"] for a in apps}

# ---- themes: top 20 named themes by scan count
by_theme = collections.defaultdict(list)
for s in scan:
    t = s.get("theme") or {}
    if t.get("custom") or t.get("notExposed") or not t.get("base"): continue
    by_theme[t["base"]].append(s)
store_theme_meta = {}
def theme_info(name, sample):
    t = sample["theme"]; tid = str(t.get("id")) if t.get("id") else None
    db = themes_db.get(tid) if tid else None
    if not db:  # free Shopify themes (Dawn, Horizon...) often report no id: match by name
        for k, v in themes_db.items():
            if v["name"].lower() == name.lower(): db, tid = v, k; break
    p = next((x for x in prem if name.lower() in [a.lower() for a in x.get("aliases", [])] or x["name"].lower() == name.lower()), None)
    slug = (db or {}).get("slug") or re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    url = f"https://themes.shopify.com/themes/{db['slug']}" if db else (p or {}).get("buyUrl")
    affurl = (saff.get("_themes") or {}).get(name) or (aff["themes"].get(name) or {}).get("affiliate") \
        or (aff["premium_themes"].get(name) or {}).get("affiliate")
    if not affurl:
        tpl = (aff["theme_vendors"].get(t.get("vendor") or "") or {}).get("affiliate_template")
        if tpl and url: affurl = tpl.replace("{url}", url)
    return {"slug": slug, "name": name, "vendor": (db or {}).get("vendor") or t.get("vendor") or (p or {}).get("vendor"),
            "theme_store_id": int(tid) if db else None, "price": (db or {}).get("price") or (p or {}).get("price"),
            "marketplace": "Shopify Theme Store" if db else (p or {}).get("marketplace"),
            "official_url": url, "affiliate": {"url": affurl} if affurl else None}
top_themes = sorted(by_theme.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:20]
themes = []
for name, ss in top_themes:
    ti = theme_info(name, ss[0]); ti["scan"] = {"stores": len(ss)}; themes.append(ti)
THEME_SLUG = {t["name"]: t["slug"] for t in themes}

# ---- stores: per theme, best store = most top-50 apps, then best tranco rank
def score(s):
    n = len([a for a in s.get("apps", []) if (a if isinstance(a, str) else a.get("slug")) in APPS])
    r = trank(s["final"] or s["host"]) or 10**7
    return (-n, r)
def app_slugs(s):
    out = []
    for a in s.get("apps", []):
        if isinstance(a, str): out.append({"slug": a, "confidence": None})
        else: out.append({"slug": a.get("slug"), "confidence": a.get("confidence") or a.get("conf")})
    return out
stores, picked = [], set()
for name, ss in top_themes:
    for s in sorted(ss, key=score):
        if s["host"] in picked or s.get("status") != 200: continue
        picked.add(s["host"]); break
# top up to 20 (already 20) – keep deterministic
for s in scan:
    if s["host"] not in picked: continue
    t = s["theme"]
    stores.append({
        "domain": (s.get("final") or s["host"]).removeprefix("www."), "url": f"https://{s.get('final') or s['host']}",
        "theme": {"slug": THEME_SLUG[t["base"]], "name": t["base"], "version": t.get("v"), "raw_name": t.get("name")},
        "apps": app_slugs(s), "pixels": s.get("pixels", []), "currency": s.get("currency"),
        "tranco_rank": trank(s.get("final") or s["host"]),
        "detected_at": s["at"], "source": "storepeek scan 2026-11-17 (pre-v7 rules)",
    })
stores.sort(key=lambda x: x["tranco_rank"] or 10**7)

# ---- all raw detections (930 stores) for richer app<->store / theme<->store links
raw = [{"domain": (s.get("final") or s["host"]).removeprefix("www."),
        "theme": (s.get("theme") or {}).get("base"), "theme_custom": (s.get("theme") or {}).get("custom"),
        "apps": [a["slug"] for a in app_slugs(s)], "currency": s.get("currency"), "detected_at": s["at"]}
       for s in scan]

# ---- affiliate links table (no notes / personal info)
links = []
for a in apps:
    if a["affiliate"]: links.append({"target_type": "app", "target_slug": a["slug"], **a["affiliate"]})
for t in themes:
    if t["affiliate"]: links.append({"target_type": "theme", "target_slug": t["slug"], "url": t["affiliate"]["url"], "program": None})
seen = {(l["target_type"], l["url"]) for l in links}
with open(SP / "store/shoffi-links.csv") as f:
    for r in csv.DictReader(f):
        if ("app", r["referral_link"]) not in seen:
            links.append({"target_type": "app", "target_name": r["app"], "url": r["referral_link"], "program": "Shoffi"})
with open(SP / "store/foxecom-links.csv") as f:
    for r in csv.DictReader(f):
        if (r["type"], r["referral_link"]) not in seen:
            links.append({"target_type": r["type"], "target_name": r["item"], "url": r["referral_link"], "program": "FoxEcom"})
programs = []
with open(SP / "store/applied-programs.csv") as f:
    for row in csv.reader(f):
        if len(row) < 3 or row[0].lower() in ("program", "name"): continue
        programs.append({"program": row[0], "network": row[1], "status": row[2]})

# light records for apps detected on seed stores but outside the top 50, so every link resolves
extra = []
for slug in sorted({a["slug"] for st in stores for a in st["apps"]} - APPS):
    g = sig.get(slug, {}); h = handle_of(slug); a = appstore.get(h, {}) if h else {}
    extra.append({"slug": slug, "app_store_handle": h, "name": a.get("name") or g.get("name") or slug,
                  "developer": a.get("developer") or g.get("vendor"), "category": g.get("category"),
                  "tagline": a.get("tagline") or g.get("description"), "rating": a.get("rating"),
                  "reviews": a.get("reviews"), "icon_url": a.get("icon"),
                  "app_store_url": a.get("url") or g.get("listing"),
                  "scan": {"stores": stats["apps"].get(slug, {}).get("stores")},
                  "affiliate": app_aff(slug, h)})
categories = sorted({a["category"] for a in apps if a["category"]})
w = lambda n, d: json.dump(d, open(OUT / n, "w"), indent=2, ensure_ascii=False)
w("apps.json", apps); w("themes.json", themes); w("stores.json", stores)
w("detections-930.json", raw); w("affiliate-links.json", links); w("affiliate-programs.json", programs)
w("categories.json", categories); w("apps-extra.json", extra)
print("extra apps", len(extra))
print(len(apps), len(themes), len(stores), len(raw), len(links), len(programs), len(categories))
print(sum(1 for a in apps if a["affiliate"]), "apps w/ aff;", sum(1 for t in themes if t["affiliate"]), "themes w/ aff")
for s in stores: print(s["domain"], s["theme"]["name"], len(s["apps"]), s["tranco_rank"])
