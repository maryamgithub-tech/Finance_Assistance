import Papa from "papaparse";
import { createHash } from "crypto";

/**
 * ============================================================================
 * CSV INGEST — turn a messy bank export into clean, deduped transactions.
 * ----------------------------------------------------------------------------
 * Handles real-world dirt deterministically (no LLM): preamble/footer lines,
 * mixed date formats, "PKR"/"Rs" + thousands separators, parentheses-negatives,
 * POS/ATM noise, duplicates, missing fields. Returns clean rows + a REPORT.
 *
 * COLUMN-FLEXIBLE: maps headers by keyword, so it accepts both common layouts —
 *   (a) separate Debit/Credit (or Withdrawal/Deposit) columns, and
 *   (b) a single signed Amount column.
 * This is what lets a brand-new bank's export work without code changes.
 * ============================================================================
 */

export type CleanTxn = {
  user_id: string;
  txn_date: string;
  amount: number; // negative = spend, positive = income
  currency: string;
  merchant_raw: string;
  merchant_normalized: string;
  category: string;
  description: string;
  source: "csv";
  dedupe_hash: string;
};

export type IngestReport = {
  total_data_rows: number;
  inserted: number;
  duplicates: number;
  skipped: { line: string; reason: string }[];
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/); // DD/MM/YYYY or DD-MM-YYYY (day-first)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/); // DD-Mon-YYYY
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1]}`;
  m = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/); // YYYY-MM-DD or YYYY/MM/DD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function parseMoney(v?: string): number | null {
  if (!v) return null;
  let s = v.trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }      // (1,200) => negative
  s = s.replace(/pkr|rs\.?/i, "").replace(/[,\s]/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

const NOISE = [
  /\bPOS PURCHASE\b/gi, /\bPOS\b/gi, /\bATM WITHDRAWAL\b/gi, /\bATM WDL\b/gi,
  /\bATM\b/gi, /\bIBFT TO\b/gi, /\bIBFT\b/gi, /\bFUND TRANSFER\b/gi,
  /\b1LINK\b/gi, /\bBILL PAYMENT\b/gi, /\bBILL\b/gi, /\bPREPAID LOAD\b/gi,
  /\bRIDE\b/gi, /\bORDER\b/gi, /\bPAYMENT\b/gi, /\bPK\b/gi,
];
const CITY = /\b(LHR|KHI|ISB|RWP|FSD|MUL|PEW|GUJ|DHA)\b/gi;

function normalizeMerchant(desc: string): string {
  let s = desc;
  for (const re of NOISE) s = s.replace(re, " ");
  s = s
    .replace(CITY, " ")
    .replace(/\.(com|pk)\b/gi, "")
    .replace(/[*#]\d+/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return desc.trim();
  return s.toLowerCase().replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

const RULES: [RegExp, string][] = [
  [/\brent\b/i, "Housing"],
  [/imtiaz|al-?fatah|metro|carrefour|hyperstar|naheed|save ?mart|springs|super ?market|mart|grocery/i, "Groceries"],
  [/foodpanda|kfc|mcdonald|pizza|cafe|restaurant|baker|bakery|cheezious|شیزان/i, "Dining"],
  [/careem|uber|indrive|bykea|yango/i, "Transport"],
  [/pso|shell|total|attock|byco|filling station|fuel|petrol/i, "Fuel"],
  [/k-?electric|lesco|iesco|gepco|wapda|sngpl|ssgc|gas bill|electric|water bill/i, "Utilities"],
  [/jazz|zong|telenor|ufone|warid|ptcl|prepaid|postpaid|mobile load/i, "Telecom"],
  [/netflix|spotify|youtube|disney|prime video|icloud|google one/i, "Subscriptions"],
  [/daraz|alibaba|amazon|khaadi|sapphire|shopping/i, "Shopping"],
  [/salary|payroll/i, "Income"],
  [/ibft|fund transfer|transfer to|raast|easypaisa|jazzcash/i, "Transfer"],
  [/atm|withdrawal|wdl|cash/i, "Cash"],
];

function categorize(desc: string, amount: number): string {
  if (amount > 0 && /salary|payroll|credit/i.test(desc)) return "Income";
  for (const [re, cat] of RULES) if (re.test(desc)) return cat;
  return "Uncategorized";
}

// Map whatever headers a bank used onto the fields we need.
function mapColumns(fields: string[]) {
  const find = (res: RegExp[]) => fields.find((f) => res.some((re) => re.test(f)));
  const dateCol =
    fields.find((f) => /(txn|transaction).*date/i.test(f)) ||
    fields.find((f) => /date/i.test(f) && !/value|posting/i.test(f)) ||
    fields.find((f) => /date/i.test(f));
  const valueDateCol = fields.find((f) => /value.*date/i.test(f));
  const descCol = find([/desc/i, /narration/i, /particular/i, /details/i, /remark/i]);
  const debitCol = find([/debit/i, /withdrawal/i, /\bdr\b/i]);
  const creditCol = find([/credit/i, /deposit/i, /\bcr\b/i]);
  const amountCol = !debitCol && !creditCol ? find([/amount/i]) : undefined;
  return { dateCol, valueDateCol, descCol, debitCol, creditCol, amountCol };
}

function findHeaderIndex(lines: string[]): number {
  return lines.findIndex(
    (l) =>
      /date/i.test(l) &&
      /debit|credit|description|narration|withdrawal|deposit|amount|particular|details/i.test(l)
  );
}

const JUNK = /opening balance|closing balance|balance b\/f|brought forward|end of statement|statement period|account (number|no)|generated/i;

export function ingestCsv(text: string, userId: string): { transactions: CleanTxn[]; report: IngestReport } {
  const lines = text.split(/\r?\n/);
  const headerIdx = findHeaderIndex(lines);
  const body = headerIdx >= 0 ? lines.slice(headerIdx).join("\n") : text;

  const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
  const map = mapColumns(parsed.meta.fields ?? []);

  const skipped: IngestReport["skipped"] = [];
  const seen = new Set<string>();
  const transactions: CleanTxn[] = [];
  let duplicates = 0;
  let dataRows = 0;

  for (const row of parsed.data) {
    const desc = (map.descCol ? row[map.descCol] : "")?.trim() ?? "";
    const rawLine = Object.values(row).join(",");
    const debitRaw = map.debitCol ? row[map.debitCol] : undefined;
    const creditRaw = map.creditCol ? row[map.creditCol] : undefined;
    const amountRaw = map.amountCol ? row[map.amountCol] : undefined;

    if (!desc && !debitRaw && !creditRaw && !amountRaw) continue;
    dataRows++;

    if (JUNK.test(desc)) {
      skipped.push({ line: rawLine, reason: "structural/non-transaction row" });
      continue;
    }

    const date = parseDate(map.dateCol ? row[map.dateCol] : undefined) ??
      parseDate(map.valueDateCol ? row[map.valueDateCol] : undefined);
    if (!date) {
      skipped.push({ line: rawLine, reason: "unparseable/missing date" });
      continue;
    }

    // Amount: prefer Debit/Credit pair; else a single signed Amount column.
    let amount: number | null = null;
    if (map.debitCol || map.creditCol) {
      const debit = parseMoney(debitRaw);
      const credit = parseMoney(creditRaw);
      if (debit === null && credit === null) {
        skipped.push({ line: rawLine, reason: "no valid amount" });
        continue;
      }
      amount = credit !== null ? Math.abs(credit) : -Math.abs(debit as number);
    } else {
      const v = parseMoney(amountRaw);
      if (v === null) {
        skipped.push({ line: rawLine, reason: "no valid amount" });
        continue;
      }
      amount = v; // signed: negative = spend, positive = income
    }

    const merchant_raw = desc || "Unknown";
    const merchant_normalized = desc ? normalizeMerchant(desc) : "Unknown";
    const category = desc ? categorize(desc, amount) : "Uncategorized";

    const dedupe_hash = createHash("sha1")
      .update(`${userId}|${date}|${amount}|${merchant_raw}`)
      .digest("hex");
    if (seen.has(dedupe_hash)) { duplicates++; continue; }
    seen.add(dedupe_hash);

    transactions.push({
      user_id: userId, txn_date: date, amount, currency: "PKR",
      merchant_raw, merchant_normalized, category, description: desc,
      source: "csv", dedupe_hash,
    });
  }

  return { transactions, report: { total_data_rows: dataRows, inserted: transactions.length, duplicates, skipped } };
}
