import Papa from "papaparse";
import { createHash } from "crypto";

/**
 * ============================================================================
 * CSV INGEST  —  turn a messy bank export into clean, deduped transactions.
 * ----------------------------------------------------------------------------
 * Real statements are dirty: preamble/footer lines, mixed date formats, amounts
 * with "PKR" and thousands separators, debit/credit in separate columns, POS/ATM
 * noise in descriptions, duplicates, and missing fields. This module handles all
 * of that DETERMINISTICALLY (no LLM) and returns both the clean rows and a
 * REPORT of what was skipped/deduped — so the UI can be honest and the design
 * note can show exactly how messy input is handled.
 *
 * Categorisation is rule-based here (cheap, consistent). It could be upgraded to
 * an LLM pass for the long tail later, but doing it at ingest keeps every query
 * fast and the model out of the hot path.
 * ============================================================================
 */

export type CleanTxn = {
  user_id: string;
  txn_date: string; // YYYY-MM-DD
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
  inserted: number; // unique, clean
  duplicates: number;
  skipped: { line: string; reason: string }[];
};

// --- Date parsing: tolerate the common Pakistani-statement formats ----------
const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(raw?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // DD/MM/YYYY  (Pakistani convention is day-first — documented assumption)
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // DD-MM-YYYY
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // DD-Mon-YYYY
  m = s.match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1]}`;
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  return null;
}

// --- Amount parsing: strip "PKR", commas, spaces; combine debit/credit ------
function parseMoney(v?: string): number | null {
  if (!v) return null;
  const cleaned = v.replace(/pkr/i, "").replace(/[,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// --- Merchant normalisation: peel away POS/ATM/ref noise --------------------
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
    .replace(/\.(com|pk)\b/gi, "") // netflix.com -> netflix, daraz.pk -> daraz
    .replace(/[*#]\d+/g, " ") // *345, #42
    .replace(/\b\d{3,}\b/g, " ") // long reference/terminal numbers
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ") // keep letters (any script), digits, a few symbols
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return desc.trim();
  // Title-case latin words; leave non-latin (e.g. Urdu) as-is.
  return s
    .toLowerCase()
    .replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
}

// --- Rule-based categorisation (matched on the original description) --------
const RULES: [RegExp, string][] = [
  [/\brent\b/i, "Housing"],
  [/imtiaz|al-?fatah|metro|carrefour|hyperstar|naheed|super ?market|mart|grocery/i, "Groceries"],
  [/foodpanda|kfc|mcdonald|pizza|cafe|restaurant|baker|bakery|شیزان/i, "Dining"],
  [/careem|uber|indrive|bykea|yango/i, "Transport"],
  [/pso|shell|total|attock|byco|filling station|fuel|petrol/i, "Fuel"],
  [/k-?electric|lesco|iesco|gepco|wapda|sngpl|ssgc|gas bill|electric|water bill/i, "Utilities"],
  [/jazz|zong|telenor|ufone|warid|ptcl|prepaid|postpaid|mobile load/i, "Telecom"],
  [/netflix|spotify|youtube|disney|prime video|icloud|google one/i, "Subscriptions"],
  [/daraz|alibaba|amazon|shopping/i, "Shopping"],
  [/salary|payroll/i, "Income"],
  [/ibft|fund transfer|transfer to|raast/i, "Transfer"],
  [/atm|withdrawal|wdl|cash/i, "Cash"],
];

function categorize(desc: string, amount: number): string {
  if (amount > 0 && /salary|payroll|credit/i.test(desc)) return "Income";
  for (const [re, cat] of RULES) if (re.test(desc)) return cat;
  return "Uncategorized";
}

// --- Find the real header row (skip statement preamble) ---------------------
function findHeaderIndex(lines: string[]): number {
  return lines.findIndex(
    (l) => /date/i.test(l) && (/debit/i.test(l) || /credit/i.test(l) || /description/i.test(l))
  );
}

const JUNK = /opening balance|closing balance|balance b\/f|end of statement|statement period|account (number|no)|generated/i;

export function ingestCsv(text: string, userId: string): {
  transactions: CleanTxn[];
  report: IngestReport;
} {
  const lines = text.split(/\r?\n/);
  const headerIdx = findHeaderIndex(lines);
  const body = headerIdx >= 0 ? lines.slice(headerIdx).join("\n") : text;

  const parsed = Papa.parse<Record<string, string>>(body, {
    header: true,
    skipEmptyLines: true,
  });

  const skipped: IngestReport["skipped"] = [];
  const seen = new Set<string>();
  const transactions: CleanTxn[] = [];
  let duplicates = 0;
  let dataRows = 0;

  for (const row of parsed.data) {
    const desc = (row["Description"] ?? "").trim();
    const rawLine = Object.values(row).join(",");

    // Skip blank/structural rows fast.
    if (!desc && !row["Debit"] && !row["Credit"]) continue;
    dataRows++;

    if (JUNK.test(desc)) {
      skipped.push({ line: rawLine, reason: "structural/non-transaction row" });
      continue;
    }

    const date = parseDate(row["Txn Date"]) ?? parseDate(row["Value Date"]);
    if (!date) {
      skipped.push({ line: rawLine, reason: "unparseable/missing date" });
      continue;
    }

    const debit = parseMoney(row["Debit"]);
    const credit = parseMoney(row["Credit"]);
    if (debit === null && credit === null) {
      skipped.push({ line: rawLine, reason: "no valid amount" });
      continue;
    }
    const amount = credit !== null ? Math.abs(credit) : -Math.abs(debit as number);

    // Missing description is repaired (kept as Unknown), not dropped — it is
    // still a real spend with a date and amount.
    const merchant_raw = desc || "Unknown";
    const merchant_normalized = desc ? normalizeMerchant(desc) : "Unknown";
    const category = desc ? categorize(desc, amount) : "Uncategorized";

    const dedupe_hash = createHash("sha1")
      .update(`${userId}|${date}|${amount}|${merchant_raw}`)
      .digest("hex");

    if (seen.has(dedupe_hash)) {
      duplicates++;
      continue;
    }
    seen.add(dedupe_hash);

    transactions.push({
      user_id: userId,
      txn_date: date,
      amount,
      currency: "PKR",
      merchant_raw,
      merchant_normalized,
      category,
      description: desc,
      source: "csv",
      dedupe_hash,
    });
  }

  return {
    transactions,
    report: { total_data_rows: dataRows, inserted: transactions.length, duplicates, skipped },
  };
}
