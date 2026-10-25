"""Калибровка по датасетам кейса: матрица «отрасль × продукт», факты для презентации и выборка компаний для демо.

    python -X utf8 tools/dataset_calibration.py <папка с df_Uid_data_hack.csv и df_Uid_payment_hack.csv>

Результат: app/data/dataset_calibration.json (компактный, без исходных таблиц). Только стандартная библиотека.
"""

import csv
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "dataset_calibration.json"
SKB_REVENUE = 500e6
LARGE_REVENUE = 10e9
csv.field_size_limit(10**8)

# Продуктовые флаги датасета → коды продуктов движка (по выданным продуктам считаем «похожих клиентов»)
FLAG_TO_PRODUCT = {"CL_PRODUCT_LOA_MARK": "working", "CL_PRODUCT_LEA_MARK": "leasing", "CL_PRODUCT_DEP_MARK": "deposit",
                   "FACTORING_MARK": "factoring"}
OWNED_FLAGS = {**FLAG_TO_PRODUCT, "CL_PRODUCT_GAR_MARK": "guarantee", "CL_PRODUCT_ZPP_MARK": "payroll", "CL_PRODUCT_RKO_MARK": "rko"}


def industry(okved: str) -> str:
    """Раздел ОКВЭД → отрасль движка. Строительство и прочие услуги — «Не определена» (отдельной отрасли в движке нет)."""
    try:
        s = int(okved.split(".")[0])
    except ValueError:
        return "unk"
    if s in (1, 2, 3, 10, 11):
        return "agro"
    if s == 47:
        return "retail"
    if s == 46:
        return "trade"
    if s in (58, 61, 62, 63):
        return "it"
    if 49 <= s <= 53:
        return "log"
    if 5 <= s <= 33:
        return "mfg"
    return "unk"


def flag(v: str) -> bool:
    return v in ("1", "1.0")


def read(name: str):
    with open(SRC / name, encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


orgs = {r["SYNTHETIC_U"]: r for r in read("df_Uid_data_hack.csv")}
rev = {u: float(r["REVENUE_COMPANY"] or 0) for u, r in orgs.items()}
ind = {u: industry(r["MAINOKVED_CODE"]) for u, r in orgs.items()}
skb = {u for u in orgs if rev[u] >= SKB_REVENUE}
clients = [u for u in skb if orgs[u]["CL_TYPE"] == "CLIENT"]

# ---------- Матрица «отрасль × продукт» по похожим клиентам СКБ ----------
def penetration(us: list[str], col: str) -> float:
    if col == "FTS_FLAG":
        return sum(flag(orgs[u]["FTS_FLAG"]) for u in us) / len(us)
    return sum(flag(orgs[u][col]) for u in us) / len(us)


base_pen = {col: penetration(clients, col) for col in (*FLAG_TO_PRODUCT, "FTS_FLAG")}
by_ind: dict[str, list[str]] = defaultdict(list)
for u in clients:
    by_ind[ind[u]].append(u)
industry_k: dict[str, dict[str, float]] = {}
penetration_table: dict[str, dict] = {}
for i, us in sorted(by_ind.items()):
    row, pen = {}, {"n": len(us)}
    for col, code in (*FLAG_TO_PRODUCT.items(), ("FTS_FLAG", "ved")):
        p = penetration(us, col)
        pen[code] = round(p * 100, 1)
        if code == "factoring" or i == "unk":
            continue  # факторинг почти не выдан (0,2%) — данных мало; «Не определена» не калибруем
        k = round(min(1.4, max(0.7, p / base_pen[col])), 1) if base_pen[col] else 1.0
        if k != 1.0:
            row[code] = k
    penetration_table[i] = pen
    if i != "unk":
        industry_k[i] = row

# ---------- Группы и платежи ----------
groups: dict[str, list[str]] = defaultdict(list)
for u, r in orgs.items():
    if r["GROUP_ID"]:
        groups[r["GROUP_ID"]].append(u)
multi = {g: us for g, us in groups.items() if len(us) > 1}
mixed = dominant = 0
for us in multi.values():
    if len({ind[u] for u in us}) > 1:
        mixed += 1
    by = defaultdict(float)
    for u in us:
        by[ind[u]] += rev[u]
    tot = sum(by.values())
    if tot and max(by.values()) / tot >= 0.5:
        dominant += 1

net = defaultdict(float)  # внутригрупповой поток: + получает, − отдаёт
total = intra = 0.0
for r in read("df_Uid_payment_hack.csv"):
    a = float(r["PAY_AMT"] or 0)
    total += a
    p, b = r["PAYER"], r["BENEFICIARY"]
    if p in orgs and b in orgs and orgs[p]["GROUP_ID"] and orgs[p]["GROUP_ID"] == orgs[b]["GROUP_ID"]:
        intra += a
        net[b] += a
        net[p] -= a

fts_skb = [u for u in skb if flag(orgs[u]["FTS_FLAG"])]
countries = Counter()
for u in fts_skb:
    for c in orgs[u]["FTS_COUNTRY_NAME"].split(","):
        if c.strip():
            countries[c.strip().title()] += 1

stats = {
    "companies": len(orgs),
    "skb": len(skb),
    "skb_share_pct": round(100 * len(skb) / len(orgs), 1),
    "skb_large": sum(1 for u in skb if rev[u] >= LARGE_REVENUE),
    "skb_clients": len(clients),
    "skb_by_industry": dict(Counter(ind[u] for u in skb).most_common()),
    "groups_multi": len(multi),
    "groups_multi_mixed_industry_pct": round(100 * mixed / len(multi), 1),
    "groups_multi_dominant_50_pct": round(100 * dominant / len(multi), 1),
    "companies_in_groups_pct": round(100 * sum(len(v) for v in multi.values()) / len(orgs), 1),
    "payments_intra_group_pct": round(100 * intra / total, 1),
    "skb_foreign_trade_pct": round(100 * len(fts_skb) / len(skb), 1),
    "foreign_trade_countries": dict(countries.most_common(5)),
    "key_owner_pct": round(100 * sum(1 for u in skb if flag(orgs[u]["NEGATIVEMARK"])) / len(skb), 1),
    "client_penetration_pct": {code: round(100 * base_pen[col], 1) for col, code in (*FLAG_TO_PRODUCT.items(), ("FTS_FLAG", "ved"))},
    "penetration_by_industry_pct": penetration_table,
}

# ---------- Выборка компаний для демо ----------
rng = random.Random(13)


def card(u: str) -> dict:
    r = orgs[u]
    owned = sorted({code for col, code in OWNED_FLAGS.items() if flag(r[col])})
    balance = None
    if r["GROUP_ID"] in multi:
        balance = "credit" if net[u] > 0 else "surplus"
    return {
        "uid": u, "okved": r["MAINOKVED_CODE"], "okved_name": r["MAINOKVED_NAME"][:120], "industry": ind[u],
        "revenue_mln": max(1, round(rev[u] / 1e6)), "client_type": r["CL_TYPE"], "owned": owned,
        "foreign_trade": flag(r["FTS_FLAG"]), "countries": r["FTS_COUNTRY_NAME"], "stage": r["ECO_MARK_LABEL"],
        "key_owner": flag(r["NEGATIVEMARK"]), "group": r["GROUP_ID"] if r["GROUP_ID"] in multi else None,
        "balance": balance, "city": r["CITY"], "workers": r["AMOUNT_WORKERS_FNS_GRADATION"],
    }


sample: list[dict] = []
taken: set[str] = set()
solo = [u for u in skb if orgs[u]["GROUP_ID"] not in multi and orgs[u]["CL_TYPE"] != "CLOSE_CLIENT"]
for i in ("agro", "retail", "it", "log", "trade", "mfg", "unk"):
    pool = sorted(u for u in solo if ind[u] == i)
    for u in rng.sample(pool, min(8, len(pool))):
        sample.append(card(u))
        taken.add(u)
# Группы 2–4 юрлица, где головная — СКБ: половина с разными отраслями
cand = sorted(g for g, us in multi.items() if 2 <= len(us) <= 4 and max(rev[u] for u in us) >= SKB_REVENUE)
mixed_g = [g for g in cand if len({ind[u] for u in multi[g]}) > 1]
same_g = [g for g in cand if len({ind[u] for u in multi[g]}) == 1]
for g in rng.sample(mixed_g, 6) + rng.sample(same_g, 4):
    for u in sorted(multi[g], key=lambda x: -rev[x]):
        sample.append(card(u))

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps({"source": "Датасеты кейса (df_Uid_data_hack, df_Uid_payment_hack), синтетические идентификаторы",
                           "stats": stats, "industry_k": industry_k, "sample": sample}, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps({"stats": {k: v for k, v in stats.items() if k != "penetration_by_industry_pct"}, "industry_k": industry_k}, ensure_ascii=False, indent=1))
print("penetration:", json.dumps(penetration_table, ensure_ascii=False))
print("sample:", len(sample), "->", OUT)
