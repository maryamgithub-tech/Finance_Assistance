import { createClient } from "@/utils/supabase/server";
import {
  querySpending, categoryBreakdown, listRecurring,
  listAnomalies, getBudgetStatus, latestTxnDate,
} from "@/lib/db/queries";

export const runtime = "nodejs";

// Powers the dashboard panel. All aggregation stays in the data layer; this just
// assembles a compact summary for the current month (the month of latest data).
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const ref = await latestTxnDate(supabase, user.id);
  if (!ref) return Response.json({ empty: true });

  const y = ref.getUTCFullYear(), m = ref.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);

  const [total, byCat, recurring, anomalies, budgets] = await Promise.all([
    querySpending(supabase, user.id, { start_date: start, end_date: end }),
    categoryBreakdown(supabase, user.id, start, end),
    listRecurring(supabase, user.id),
    listAnomalies(supabase, user.id, { limit: 4 }),
    getBudgetStatus(supabase, user.id, {}),
  ]);

  return Response.json({
    month: start.slice(0, 7),
    total_spend: total.total_spent,
    by_category: byCat,
    recurring: recurring.recurring,
    anomalies: anomalies.anomalies,
    budgets: budgets.budgets ?? [],
  });
}
