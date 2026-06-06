import { createHash } from "crypto";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { receipt_id, edits } = await req.json();
  const { data: r } = await supabase
    .from("receipts")
    .select("extracted")
    .eq("id", receipt_id)
    .eq("user_id", user.id)
    .single();
  if (!r) return Response.json({ error: "Receipt not found" }, { status: 404 });

  // Allow the user to correct fields before confirming.
  const e = { ...r.extracted, ...(edits ?? {}) };
  const date = e.txn_date || new Date().toISOString().slice(0, 10);
  const amount = -Math.abs(Number(e.total) || 0);
  const merchant = e.merchant || "Unknown";
  const dedupe_hash = createHash("sha1")
    .update(`${user.id}|${date}|${amount}|${merchant}`)
    .digest("hex");

  const { data: txn, error } = await supabase
    .from("transactions")
    .upsert(
      {
        user_id: user.id,
        txn_date: date,
        amount,
        currency: e.currency || "PKR",
        merchant_raw: merchant,
        merchant_normalized: merchant,
        category: e.category || "Uncategorized",
        description: `Receipt: ${merchant}`,
        source: "receipt",
        dedupe_hash,
      },
      { onConflict: "user_id,dedupe_hash", ignoreDuplicates: false }
    )
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await supabase
    .from("receipts")
    .update({ status: "confirmed", linked_txn_id: txn?.id })
    .eq("id", receipt_id);

  // Keep insights current after adding the new expense.
  await supabase.rpc("refresh_recurring");
  await supabase.rpc("refresh_anomalies");

  return Response.json({ ok: true, transaction: txn });
}
