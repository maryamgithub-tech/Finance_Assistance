#!/usr/bin/env python3
"""Generate a synthetic, messy, 4-month Pakistani bank statement (NOT real data).
Reproducible (fixed seed). Includes fixed subscriptions, variable bills, an
April spending spike, a planted anomaly, plus deliberate dirt (duplicates,
junk, missing fields, mixed date formats, Urdu merchant)."""
import random
from datetime import date, timedelta

random.seed(42)
rows = []  # each: (date, desc, debit, credit)

def add(d, desc, debit=None, credit=None):
    rows.append((d, desc, debit, credit))

GROCERS = ["IMTIAZ SUPER MARKET LHR", "METRO CASH CARRY LHR", "AL-FATAH STORE LHR"]
DINING  = ["FOODPANDA PK LAHORE", "KFC GULBERG LHR", "PIZZA HUT DHA LHR"]
FUEL    = ["PSO FILLING STATION LHR", "SHELL FUEL DHA LHR"]

for month in range(1, 5):  # Jan..Apr 2025
    spike = 1.8 if month == 4 else 1.0  # April spends more than usual
    add(date(2025, month, 1), "SALARY CREDIT ACME TECH PVT LTD", credit=200000)
    add(date(2025, month, 2), "MONTHLY RENT PAYMENT IBFT", debit=55000)          # fixed -> recurring
    add(date(2025, month, 5), "NETFLIX.COM 8829", debit=1499)                    # fixed -> recurring
    add(date(2025, month, 10), "SPOTIFY P1234567", debit=349)                    # fixed -> recurring
    add(date(2025, month, 7), "K-ELECTRIC BILL PAYMENT 1LINK", debit=random.randint(6000, 12000))  # variable bill
    add(date(2025, month, 15), "SSGC GAS BILL 1LINK", debit=random.randint(2000, 4000))            # variable bill
    add(date(2025, month, 18), "PTCL BILL 1LINK 0042", debit=3100)               # fixed -> recurring
    add(date(2025, month, 12), "JAZZ PREPAID LOAD *345", debit=1000)

    for _ in range(int(round(5 * spike))):
        d = date(2025, month, random.randint(1, 28))
        add(d, f"POS PURCHASE {random.randint(1000,9999)} {random.choice(GROCERS)}", debit=random.randint(1500, 8000))
    for _ in range(int(round(5 * spike))):
        d = date(2025, month, random.randint(1, 28))
        add(d, f"{random.choice(DINING)} {random.randint(100000,999999)}", debit=random.randint(600, 3000))
    for _ in range(2):
        d = date(2025, month, random.randint(1, 28))
        add(d, f"{random.choice(FUEL)} {random.randint(1000,9999)}", debit=random.randint(4000, 8000))
    for _ in range(random.randint(3, 5)):
        d = date(2025, month, random.randint(1, 28))
        add(d, f"CAREEM RIDE PK {random.randint(10000,99999)}", debit=random.randint(300, 900))
    add(date(2025, month, random.randint(1, 28)), f"ATM WITHDRAWAL {random.randint(1000,9999)} GULBERG LHR", debit=random.randint(10000, 20000))

# Planted anomaly: one huge Shopping charge in April (z-score outlier).
add(date(2025, 4, 21), "DARAZ.PK LAPTOP ORDER 5567123", debit=145000)
# A few normal Daraz buys so Shopping has a baseline.
for m in (1, 2, 3):
    add(date(2025, m, random.randint(5, 25)), "DARAZ.PK ORDER 5567123", debit=random.randint(2000, 6000))
# Urdu merchant once.
add(date(2025, 3, 20), "POS شیزان بیکرز LHR", debit=1750)

rows.sort(key=lambda r: r[0])

# --- Inject dirt ----------------------------------------------------------
dirty = []
dirty.append(("preamble",))  # marker handled below
inserted_dup = False
inserted_missing = False
for i, r in enumerate(rows):
    dirty.append(r)
    if not inserted_dup and r[2] and "IMTIAZ" in r[1]:
        dirty.append(r)              # exact duplicate
        inserted_dup = True
    if not inserted_missing and i == 12:
        dirty.append((r[0], "", 2500, None))  # missing description, real amount

def fmt_date(d, i):
    return d.strftime("%d-%b-%Y") if i % 4 == 0 else d.strftime("%d/%m/%Y")

def money(v):
    if v is None:
        return ""
    s = f"{v:,.2f}"
    return f'"{s}"' if "," in s else s

lines = [
    "HBL Bank - Account Statement",
    "Account Number: PK36HABB0000123456789012",
    "Statement Period: 01-Jan-2025 to 30-Apr-2025",
    "Generated On: 02-May-2025",
    "",
    "Txn Date,Value Date,Description,Debit,Credit,Balance",
    '01/01/2025,01/01/2025,Opening Balance,,,"125,300.00"',
]
i = 0
for r in dirty:
    if r == ("preamble",):
        continue
    d, desc, debit, credit = r
    ds = fmt_date(d, i)
    # Netflix gets a "PKR" prefix to test currency-prefix parsing.
    deb = money(debit)
    if desc.startswith("NETFLIX") and debit:
        deb = '"PKR 1,499.00"'
    lines.append(f"{ds},{ds},{desc},{deb},{money(credit)},")
    i += 1

lines.append("not-a-date,,GARBAGE ROW SHOULD BE SKIPPED,abc,,")
lines.append('30/04/2025,30/04/2025,Closing Balance,,,"410,000.00"')
lines.append("*** End of Statement ***")

with open("data/sample_transactions.csv", "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"wrote {len(lines)} lines")
