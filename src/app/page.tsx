"use client";

// TEMPORARY minimal page so steps 3–5 are testable. Real UI comes in step 6.
import { useChat } from "@ai-sdk/react";
import { useState } from "react";

type Extracted = {
  merchant: string; total: number; txn_date: string;
  currency: string; category: string; confidence: number; notes?: string;
};

export default function Home() {
  const [input, setInput] = useState("");
  const [uploadMsg, setUploadMsg] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; data: Extracted } | null>(null);
  const { messages, sendMessage } = useChat();

  async function uploadCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMsg("Importing…");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/ingest", { method: "POST", body });
    const r = await res.json();
    setUploadMsg(res.ok ? `Imported ${r.inserted}, skipped ${r.skipped?.length ?? 0}, ${r.duplicates} duplicate(s).` : `Error: ${r.error}`);
  }

  async function uploadReceipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMsg("Reading receipt…");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/receipt", { method: "POST", body });
    const r = await res.json();
    if (!res.ok) return setUploadMsg(`Error: ${r.error}`);
    setUploadMsg("");
    setReceipt({ id: r.receipt_id, data: r.extracted });
  }

  async function confirmReceipt() {
    if (!receipt) return;
    const res = await fetch("/api/receipt/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receipt_id: receipt.id }),
    });
    setUploadMsg(res.ok ? "Receipt saved as an expense." : "Could not save receipt.");
    setReceipt(null);
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Finance Assistant (dev)</h1>
        <div className="flex gap-2">
          <label className="cursor-pointer rounded border px-3 py-1 text-sm">
            Upload CSV
            <input type="file" accept=".csv" className="hidden" onChange={uploadCsv} />
          </label>
          <label className="cursor-pointer rounded border px-3 py-1 text-sm">
            Upload receipt
            <input type="file" accept="image/*" className="hidden" onChange={uploadReceipt} />
          </label>
        </div>
      </div>
      {uploadMsg && <p className="mb-3 text-sm text-gray-600">{uploadMsg}</p>}

      {receipt && (
        <div className="mb-4 rounded border p-3 text-sm">
          <p className="mb-1 font-medium">
            Confirm this receipt?{" "}
            {receipt.data.confidence < 0.5 && (
              <span className="text-amber-600">(low confidence — please check)</span>
            )}
          </p>
          <p>{receipt.data.merchant || "Unknown"} — {receipt.data.currency} {receipt.data.total} — {receipt.data.txn_date || "no date"} — {receipt.data.category}</p>
          {receipt.data.notes && <p className="text-amber-600">Note: {receipt.data.notes}</p>}
          <div className="mt-2 flex gap-2">
            <button className="rounded bg-black px-3 py-1 text-white" onClick={confirmReceipt}>Confirm</button>
            <button className="rounded border px-3 py-1" onClick={() => setReceipt(null)}>Discard</button>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className="whitespace-pre-wrap">
            <span className="font-medium">{m.role === "user" ? "You: " : "AI: "}</span>
            {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (!input.trim()) return; sendMessage({ text: input }); setInput(""); }}
        className="mt-4 flex gap-2"
      >
        <input
          className="flex-1 rounded border p-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your spending…"
        />
        <button className="rounded bg-black px-4 text-white" type="submit">Send</button>
      </form>
    </div>
  );
}
