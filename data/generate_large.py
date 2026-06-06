#!/usr/bin/env python3
"""Generate a LARGE synthetic statement (~8000 rows, 5 years) to test that the
system holds up as data grows (NOT real data)."""
import random, calendar
from datetime import date

random.seed(99)
rows = []  # (date, desc, debit, credit)

def add(d, desc, debit=None, credit=None): rows.append((d, desc, debit, credit))

GROCERS = ["IMTIAZ SUPER MARKET LHR", "METRO CASH CARRY LHR", "AL-FATAH STORE LHR", "HYPERSTAR LHR"]
DINING  = ["FOODPANDA PK LAHORE", "KFC GULBERG LHR", "PIZZA HUT DHA LHR", "CHEEZIOUS PK"]
FUEL    = ["PSO FILLING STATION LHR", "SHELL FUEL DHA LHR", "TOTAL PARCO LHR"]

for year in range(2021, 2026):
    for month in range(1, 13):
        last = calendar.monthrange(year, month)[1]
        rnd = lambda: random.randint(1, last)
        add(date(year, month, 1), "SALARY CREDIT ACME TECH PVT LTD", credit=200000 + (year - 2021) * 15000)
        add(date(year, month, 2), "MONTHLY RENT PAYMENT IBFT", debit=55000)
        add(date(year, month, 5), "NETFLIX.COM 8829", debit=1499)
        add(date(year, month, 10), "SPOTIFY P1234567", debit=349)
        add(date(year, month, 18), "PTCL BILL 1LINK 0042", debit=3100)
        add(date(year, month, 7), "K-ELECTRIC BILL PAYMENT 1LINK", debit=random.randint(6000, 13000))
        add(date(year, month, 15), "SSGC GAS BILL 1LINK", debit=random.randint(2000, 4500))
        add(date(year, month, 12), "JAZZ PREPAID LOAD *345", debit=1000)
        for _ in range(random.randint(26, 34)):
            add(date(year, month, rnd()), f"POS PURCHASE {random.randint(1000,9999)} {random.choice(GROCERS)}", debit=random.randint(1500, 9000))
        for _ in range(random.randint(32, 42)):
            add(date(year, month, rnd()), f"{random.choice(DINING)} {random.randint(100000,999999)}", debit=random.randint(500, 3200))
        for _ in range(random.randint(7, 10)):
            add(date(year, month, rnd()), f"{random.choice(FUEL)} {random.randint(1000,9999)}", debit=random.randint(4000, 8500))
        for _ in range(random.randint(22, 30)):
            add(date(year, month, rnd()), f"CAREEM RIDE PK {random.randint(10000,99999)}", debit=random.randint(250, 950))
        for _ in range(random.randint(4, 7)):
            add(date(year, month, rnd()), f"DARAZ.PK ORDER {random.randint(100000,999999)}", debit=random.randint(1500, 9000))
        add(date(year, month, rnd()), f"ATM WITHDRAWAL {random.randint(1000,9999)} GULBERG LHR", debit=random.randint(10000, 25000))
        if random.random() < 0.08:  # occasional big anomaly
            add(date(year, month, rnd()), f"DARAZ.PK ELECTRONICS {random.randint(100000,999999)}", debit=random.randint(90000, 160000))

rows.sort(key=lambda r: r[0])

def money(v):
    if v is None: return ""
    s = f"{v:,.2f}"
    return f'"{s}"'

lines = [
    "HBL Bank - Account Statement",
    "Account Number: PK36HABB0000123456789012",
    "Statement Period: 01-Jan-2021 to 31-Dec-2025",
    "",
    "Txn Date,Value Date,Description,Debit,Credit,Balance",
]
i = 0
for d, desc, debit, credit in rows:
    ds = d.strftime("%d-%b-%Y") if i % 4 == 0 else d.strftime("%d/%m/%Y")
    lines.append(f"{ds},{ds},{desc},{money(debit)},{money(credit)},")
    i += 1
lines.append("*** End of Statement ***")

with open("data/large_transactions.csv", "w", encoding="utf-8") as f:
    f.write("\n".join(lines) + "\n")
print(f"wrote {len(lines)-6} transaction rows")
