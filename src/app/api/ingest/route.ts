import { createClient } from "@/utils/supabase/server";
import { ingestCsv } from "@/lib/db/ingest";

// nodejs runtime: ingest uses crypto + papaparse.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No CSV file uploaded" }, { status: 400 });
  }

  const text = await file.text();
  const { transactions, report } = ingestCsv(text, user.id);

  if (transactions.length > 0) {
    // DB-level dedupe too: unique (user_id, dedupe_hash) makes re-uploads safe.
    const { error } = await supabase
      .from("transactions")
      .upsert(transactions, {
        onConflict: "user_id,dedupe_hash",
        ignoreDuplicates: true,
      });
  if (transactions.length > 0) {
    // Batch inserts so a large statement (thousands of rows) loads reliably.
    const CHUNK = 500;
    for (let i = 0; i < transactions.length; i += CHUNK) {
      const { error } = await supabase
        .from("transactions")
        .upsert(transactions.slice(i, i + CHUNK), {
          onConflict: "user_id,dedupe_hash",
          ignoreDuplicates: true,
        });
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }

    // Refresh deterministic insights (recurring + anomalies) for this user.
    await supabase.rpc("refresh_recurring");
    await supabase.rpc("refresh_anomalies");
  }

  // Returning the report lets the UI say "imported 19, skipped 4, 1 duplicate".
  return Response.json(report);
}

}