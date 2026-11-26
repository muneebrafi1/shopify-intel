#!/usr/bin/env python3
"""Suggest more curated stores (editorial helper, run by hand).

Reads the latest local crawl (.data/crawl/scans.json: what each store says about itself, plus
detected theme and apps) and data/curation/stores.json, then:
  * fills a category (and name/country) for curated stores that have none, and
  * appends up to --add new curated stores, balanced across niches.
The category comes from keyword rules over the store's own name, <title> and meta description;
it is an editorial suggestion (the owner can correct data/curation/stores.json), never shown as a
detection. Country only from an unambiguous ccTLD. Writes data/curation/stores.json in place and
prints a report.

  python3 scripts/curation/suggest_stores.py --add 250 --per-category 30 [--dry-run]
"""
import argparse, json, re, sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Order matters only for ties; scores are hit counts (title/name hits weigh double).
RULES = [
    ("Pets", r"\b(dogs?|cats?|pets?|puppy|kitten|leash|collars?|litter|chews?)\b"),
    ("Kids & baby", r"\b(baby|babies|kids|toddlers?|children'?s?|nursery|maternity|infant|newborn)\b"),
    ("Toys & hobbies", r"\b(toys?|games?|puzzles?|lego|board games?|hobby|crafts?|yarn|knitting|cards game|collectibles?|figures?)\b"),
    ("Jewelry", r"\b(jewel(le)?ry|jewels?|rings?|necklaces?|bracelets?|earrings?|diamonds?|gold|silver|charms?|watches)\b"),
    ("Beauty", r"\b(beauty|skin ?care|cosmetics?|makeup|make-up|serums?|deodorant|fragrances?|perfumes?|hair ?care|shampoo|nails?|lashes|lipsticks?|moisturi[sz]er|spf|sunscreen|grooming|razors?|shav(e|ing))\b"),
    ("Health & wellness", r"\b(supplements?|vitamins?|protein|wellness|health|nutrition|collagen|probiotics?|electrolytes?|hydration|cbd|sleep|creatine|gut|greens|pre-?workout)\b"),
    ("Food & drink", r"\b(coffee|tea|snacks?|food|chocolate|candy|sauces?|spices?|bagels?|bakery|wine|beer|spirits|drinks?|beverages?|coffee beans|organic food|cookies|kombucha|seafood|meat|jerky|honey|pantry|olive oil|beans|grains)\b"),
    ("Home & garden", r"\b(home|furniture|sofas?|beds?|bedding|mattress(es)?|pillows?|blankets?|kitchen|cookware|decor|candles?|plants?|garden|rugs?|lighting|lamps?|towels|linens?|tableware|interiors?)\b"),
    ("Electronics", r"\b(electronics?|headphones?|speakers?|audio|chargers?|cables?|phone cases?|gadgets?|cameras?|keyboards?|tech|smart home|batter(y|ies)|drones?|gaming)\b"),
    ("Sports & outdoors", r"\b(outdoors?|camping|hiking|cycling|bikes?|bicycles?|fishing|hunting|golf|surf|ski|snowboard|climbing|running|fitness equipment|gym equipment|tactical|motorcycle|paddle|tennis|yoga mats?)\b"),
    ("Activewear", r"\b(activewear|athleisure|gym ?wear|workout clothes|leggings|sports ?bras?|training apparel|performance apparel)\b"),
    ("Footwear", r"\b(shoes?|sneakers?|boots?|footwear|sandals?|slippers?|loafers?|heels)\b"),
    ("Bags & accessories", r"\b(bags?|backpacks?|wallets?|handbags?|luggage|totes?|sunglasses|eyewear|belts?|hats?|caps?|scarves|accessories)\b"),
    ("Apparel", r"\b(clothing|apparel|fashion|dresses?|shirts?|t-shirts?|tees?|jeans|denim|hoodies?|sweaters?|knitwear|outerwear|jackets?|swimwear|lingerie|underwear|bras?|socks|menswear|womenswear|streetwear|tailored|suits?)\b"),
]
COMPILED = [(c, re.compile(p, re.I)) for c, p in RULES]

CCTLD = {"uk": "GB", "au": "AU", "ca": "CA", "nz": "NZ", "de": "DE", "fr": "FR", "it": "IT",
         "es": "ES", "nl": "NL", "se": "SE", "dk": "DK", "no": "NO", "fi": "FI", "ie": "IE",
         "in": "IN", "jp": "JP", "sg": "SG", "za": "ZA", "be": "BE", "at": "AT", "ch": "CH",
         "pl": "PL", "pt": "PT", "lt": "LT", "ae": "AE", "my": "MY", "ph": "PH", "id": "ID",
         "br": "BR", "mx": "MX", "kr": "KR", "hk": "HK", "tw": "TW", "il": "IL", "cz": "CZ"}


def country_of(domain: str):
    tld = domain.rsplit(".", 1)[-1]
    return CCTLD.get(tld)


def classify(name, title, desc):
    scores = Counter()
    strong = f"{name or ''} {title or ''}"
    for cat, rx in COMPILED:
        scores[cat] += 2 * len(rx.findall(strong)) + len(rx.findall(desc or ""))
    if not scores or scores.most_common(1)[0][1] == 0:
        return None, 0
    (best, s), *rest = scores.most_common(2) + [(None, 0)]
    second = rest[0][1] if rest else 0
    # Clothing words are everywhere ("shirts" on a coffee store): a specific niche beats Apparel
    # unless Apparel clearly dominates.
    return best, s - second


def clean_name(site_name, title, domain):
    n = site_name or ""
    if not n and title:
        n = re.split(r"\s+[|–—-]\s+|:\s", title)[0]
    n = n.strip()
    if not (2 <= len(n) <= 40) or n.lower() in {"home", "shop", "welcome", "store"}:
        return None
    if n.isupper() and len(n) > 4:
        n = n.title()
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--add", type=int, default=250)
    ap.add_argument("--per-category", type=int, default=30)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    scans = {o["scan"]["domain"]: o for o in json.loads((ROOT / ".data/crawl/scans.json").read_text())}
    cur_path = ROOT / "data/curation/stores.json"
    cur = json.loads(cur_path.read_text())
    curated = {s["domain"]: s for s in cur["stores"]}
    det = {d["domain"]: d for d in json.loads((ROOT / "data/seed/detections-930.json").read_text())}

    filled = 0
    for s in cur["stores"]:
        o = scans.get(s["domain"])
        if not o or not o.get("profile"):
            continue
        p = o["profile"]
        if s["category"] is None:
            c, margin = classify(o["scan"].get("site_name"), p.get("title"), p.get("description"))
            if c and margin >= 2:
                s["category"] = c
                filled += 1
        if s["name"] is None:
            s["name"] = clean_name(o["scan"].get("site_name"), p.get("title"), s["domain"])
        if s["country"] is None:
            s["country"] = country_of(s["domain"])

    per_cat = Counter(s["category"] for s in cur["stores"] if s["category"])
    pool = []
    for d, o in scans.items():
        sc, p = o["scan"], o.get("profile")
        if d in curated or d not in det or not p or o.get("note") or sc["platform"] != "shopify":
            continue
        if sc.get("http_status") and sc["http_status"] >= 400:
            continue
        lang = (p.get("lang") or p.get("locale") or "").lower()
        if not lang.startswith("en"):
            continue  # English storefronts first: the site's copy and search are English.
        apps = len(sc.get("apps") or [])
        if apps < 3 or not sc.get("theme"):
            continue  # Thin pages teach little; a known theme + a few apps make a useful page.
        c, margin = classify(sc.get("site_name"), p.get("title"), p.get("description"))
        if not c or margin < 2:
            continue
        name = clean_name(sc.get("site_name"), p.get("title"), d)
        quality = min(apps, 20) + (5 if not sc["theme"].get("is_custom") else 0) + margin
        pool.append((quality, d, c, name))
    pool.sort(reverse=True)

    added = []
    for quality, d, c, name in pool:
        if len(added) >= a.add:
            break
        if per_cat[c] >= a.per_category:
            continue
        per_cat[c] += 1
        added.append({"domain": d, "name": name, "category": c, "country": country_of(d)})

    print(f"filled {filled} missing categories; pool {len(pool)}; adding {len(added)}")
    print("per category:", dict(sorted(per_cat.items(), key=lambda x: -x[1])))
    for s in added[:15]:
        print("  +", s)
    if a.dry_run:
        return
    cur["stores"].extend(added)
    cur_path.write_text(json.dumps(cur, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(cur['stores'])} curated stores")


if __name__ == "__main__":
    sys.exit(main())
