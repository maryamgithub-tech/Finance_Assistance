#!/usr/bin/env python3
"""Generate a DIFFERENT-format synthetic statement (NOT real data) to prove the
parser adapts: single signed Amount column, 'Rs' prefix, DD-MM-YYYY dates, a
different merchant set, and its own dirt (preamble, duplicate, missing field,
junk row, anomaly, footer)."""
import random
from datetime import date

random.seed(7)
rows = []  # (date, narration, amount)  amount: negative=spend, positive=income

def add(d, narration, amount):
    rows.append((d, narration, amount))

GROCERS = ["SAVE MART JOHAR TOWN", "SPRINGS STORE DHA", "CARREFOUR LHR"]
DINING  = ["CHEEZIOUS PK", "OPTP CAFE LHR", "JOHNNY & JUGNU LHR"]
FUEL    = ["TOTAL PARCO LHR", "BYCO STATION LHR"]

for month in range(2, 6):  # Feb..May 2025
    spike = 1.7 if month == 5 else 1.0  # May spends more than usual
    add(date(2025, month, 1), "SALARY CREDIT NEXUS SOFT PVT LTD", 240000)
    add(date(2025, month, 3), "YOUTUBE PREMIUM", -479)        # fixed -> recurring
    add(date(2025, month, 8), "ICLOUD STORAGE APPLE", -150)   # fixed -> recurring
    add(date(2025, month, 11), "LESCO ELECTRICITY BILL", -random.randint(5000, 11000))
    add(date(2025, month, 16), "SNGPL GAS BILL", -random.randint(1800, 3500))
    add(date(2025, month, 13), "UFONE POSTPAID", -1500)       # fixed -> recurring
    for _ in range(int(round(4 * spike))):
        add(date(2025, month, random.randint(1, 28)), f"{random.choice(GROCERS)} {random.randint(1000,9999)}", -random.randint(1800, 9000))
    for _ in range(int(round(4 * spike))):
        add(date(2025, month, random.randint(1, 28)), f"{random.choice(DINING)} {random.randint(100000,999999)}", -random.randint(700, 3500))
    for _ in range(2):
        add(date(2025, month, random.randint(1, 28)), f"{random.choice(FUEL)} {random.randint(1000,9999)}", -random.randint(4500, 8500))
    for _ in range(random.randint(3, 5)):
        add(date(2025, month, random.randint(1, 28)), f"BYKEA RIDE {random.randint(10000,99999)}", -random.randint(250, 800))
    add(date(2025, month, random.randint(1, 28)), f"EASYPAISA TRANSFER {random.randint(10000,99999)}", -random.randint(5000, 15000))

# Planted anomaly: a big Shopping charge in May.
add(date(2025, 5, 19), "KHAADI FLAGSHIP STORE LHR", -88000)
for m in (2, 3, 4):
    add(date(2025, m, random.randint(5, 25)), "SAPPHIRE RETAIL LHR", -random.randint(3000, 7000))

rows.sort(key=lambda r: r[0])

# Inject dirt: duplicate + missing-narration + junk
dirty = []
dup_done = miss_done = False
for i, r in enumerate(rows):
    dirty.append(r)
    if not dup_done and "SAVE MART" in r[1]:
        dirty.append(r); dup_done = True
    if not miss_done and i == 10:
        dirty.append((r[0], "", -3200)); miss_done = True

def money(v):
    s = f"{abs(v):,.2f}"
    return f'"Rs -{s}"' if v < 0 else f'"Rs {s}"'

lines = [
    "Meezan Bank Limited",
    "Statement of Account",
    "IBAN: PK24MEZN0001230000456789",
    "Period: 01-02-2025 to 31-05-2025",
    "",
    "Date,Narration,Amount,Running Balance",
    '01-02-2025,Balance Brought Forward,"Rs 0.00",',
]
for d, narration, amount in dirty:
    lines.append(f"{d.strftime('%d-%m-%Y')},{narration},{money(amount)},")
lines.append("xx-xx-xxxx,,bad,")  # junk row
lines.append("*** End of Statement ***")

with open("data/test_transactions.csv", "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"wrote {len(lines)} lines")
