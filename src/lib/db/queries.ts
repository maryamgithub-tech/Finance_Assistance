import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Data layer the tools call. Aggregation runs in Postgres (RPC); lookups are
 * always bounded. Comparison/budget logic reuses the query_spending RPC rather
 * than pulling rows. Every call is scoped to the user (RLS + explicit user_id).
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function latestTxnDate(supabase: SupabaseClient, userId: string): Promise<Date | null> {
  const { data } = await supabase
    .from("transactions")
    .select("txn_date")
    .eq("user_id", userId)
    .order("txn_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? new Date(data.txn_date + "T00:00:00Z") : null;
}

export async function querySpending(
  supabase: SupabaseClient,
  _userId: string,
  args: { category?: string; merchant?: string; start_date: string; end_date: string }
) {
  const { data, error } = await supabase.rpc("query_spending", {
    p_category: args.category ?? null,
    p_merchant: args.merchant ?? null,
    p_start: args.start_date ?? null,
    p_end: args.end_date ?? null,
  });
  if (error) throw new Error(error.message);
  return { total_spent: Number(data ?? 0), currency: "PKR" };
}

export async function topTransactions(
  supabase: SupabaseClient,
  userId: string,
  args: { start_date: string; end_date: string; order?: "largest" | "smallest"; limit?: number }
) {
  const ascending = args.order !== "smallest"; // largest spend = most negative
  const { data, error } = await supabase
    .from("transactions")
    .select("txn_date, amount, merchant_normalized, category")
    .eq("user_id", userId)
    .lt("amount", 0)
    .gte("txn_date", args.start_date)
    .lte("txn_date", args.end_date)
    .order("amount", { ascending })
    .limit(Math.min(args.limit ?? 5, 20));
  if (error) throw new Error(error.message);
  return { transactions: data ?? [] };
}

// "More than usual?": latest month vs the trailing 3-month average. "This month"
// is the month of the latest transaction (correct for statement-style data).
export async function comparePeriods(
  supabase: SupabaseClient,
  userId: string,
  args: { category?: string }
) {
  const ref = await latestTxnDate(supabase, userId);
  if (!ref) return { error: "no transactions yet" };
  const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
  const curStart = new Date(Date.UTC(y, m, 1));
  const curEnd = new Date(Date.UTC(y, m + 1, 0));
  const baseStart = new Date(Date.UTC(y, m - 3, 1));
  const baseEnd = new Date(Date.UTC(y, m, 0)); // last day of previous month

  const cur = await querySpending(supabase, userId, {
    category: args.category, start_date: iso(curStart), end_date: iso(curEnd),
  });
  const base = await querySpending(supabase, userId, {
    category: args.category, start_date: iso(baseStart), end_date: iso(baseEnd),
  });
  const baselineAvg = base.total_spent / 3;
  const pct = baselineAvg > 0 ? Math.round(((cur.total_spent - baselineAvg) / baselineAvg) * 100) : null;
  return {
    current_month: iso(curStart).slice(0, 7),
    current: cur.total_spent,
    baseline_avg: Math.round(baselineAvg),
    pct_change: pct,
    currency: "PKR",
  };
}

export async function listRecurring(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("recurring_charges")
    .select("merchant_normalized, typical_amount, cadence, occurrences, last_seen, next_expected, confidence")
    .eq("user_id", userId)
    .order("typical_amount", { ascending: false });
  if (error) throw new Error(error.message);
  return { recurring: data ?? [] };
}

export async function listAnomalies(
  supabase: SupabaseClient,
  userId: string,
  args: { limit?: number }
) {
  const { data, error } = await supabase
    .from("anomalies")
    .select("reason, score, transactions ( txn_date, amount, merchant_normalized, category )")
    .eq("user_id", userId)
    .order("score", { ascending: false })
    .limit(Math.min(args.limit ?? 10, 20));
  if (error) throw new Error(error.message);
  return { anomalies: data ?? [] };
}

export async function getBudgetStatus(
  supabase: SupabaseClient,
  userId: string,
  args: { category?: string }
) {
  let q = supabase.from("budgets").select("category, limit_amount, period").eq("user_id", userId);
  if (args.category) q = q.eq("category", args.category);
  const { data: budgets, error } = await q;
  if (error) throw new Error(error.message);
  if (!budgets?.length) return { budgets: [] };

  const ref = (await latestTxnDate(supabase, userId)) ?? new Date();
  const start = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1));
  const end = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() + 1, 0));

  const out = [];
  for (const b of budgets) {
    const s = await querySpending(supabase, userId, {
      category: b.category, start_date: iso(start), end_date: iso(end),
    });
    const pct = b.limit_amount > 0 ? Math.round((s.total_spent / b.limit_amount) * 100) : 0;
    out.push({
      category: b.category, limit: Number(b.limit_amount), spent: s.total_spent,
      pct_used: pct, status: pct >= 100 ? "over" : pct >= 80 ? "near" : "ok",
    });
  }
  return { month: iso(start).slice(0, 7), budgets: out };
}

export async function setBudget(
  supabase: SupabaseClient,
  userId: string,
  args: { category: string; limit_amount: number }
) {
  const { error } = await supabase
    .from("budgets")
    .upsert(
      { user_id: userId, category: args.category, period: "monthly", limit_amount: args.limit_amount },
      { onConflict: "user_id,category,period" }
    );
  if (error) throw new Error(error.message);
  return { ok: true, category: args.category, limit_amount: args.limit_amount };
}

export async function rememberFact(
  supabase: SupabaseClient,
  userId: string,
  args: { fact_type: string; payload: Record<string, unknown>; raw_text: string }
) {
  const { error } = await supabase.from("user_facts").insert({
    user_id: userId, fact_type: args.fact_type, payload: args.payload, raw_text: args.raw_text,
  });
  if (error) throw new Error(error.message);
  return { saved: true };
}

// Read by the chat route (not a tool) to inject durable memory into the prompt.
export async function getUserFacts(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("user_facts")
    .select("fact_type, payload, raw_text")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return data ?? [];
}
