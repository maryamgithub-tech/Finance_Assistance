import { createClient } from "@/utils/supabase/server";
import { extractReceipt } from "@/lib/receipt";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No image uploaded" }, { status: 400 });
  }

  let extracted;
  try {
    extracted = await extractReceipt(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return Response.json({ error: "Could not read the receipt image" }, { status: 422 });
  }

  // Store as pending — we never auto-insert; the user confirms first.
  const { data, error } = await supabase
    .from("receipts")
    .insert({ user_id: user.id, extracted, confidence: extracted.confidence, status: "pending" })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ receipt_id: data.id, extracted });
}
