"use client";

import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type Extracted = { merchant: string; total: number; txn_date: string; currency: string; category: string; confidence: number; notes?: string };
type Insights = {
  empty?: boolean; month?: string; total_spend?: number;
  by_category?: { category: string; spent: number }[];
  recurring?: { merchant_normalized: string; typical_amount: number }[];
  anomalies?: { reason: string; transactions?: { merchant_normalized?: string } }[];
  budgets?: { category: string; pct_used: number; status: string }[];
};

const SUGGESTIONS = [
  "How much did I spend on dining in March 2025?",
  "What are my recurring subscriptions?",
  "Any unusual charges?",
  "Where can I cut back?",
];
const fmt = (n: number) => Math.round(n).toLocaleString();

export default function Home() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [toast, setToast] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; data: Extracted } | null>(null);
  const [ins, setIns] = useState<Insights | null>(null);
  const { messages, sendMessage, status, error } = useChat();
  const csvRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const busy = status === "submitted" || status === "streaming";

  const loadInsights = useCallback(async () => {
    const res = await fetch("/api/insights");
    if (res.ok) setIns(await res.json());
  }, []);
  useEffect(() => { loadInsights(); }, [loadInsights]);

  function send(text: string) { if (!text.trim() || busy) return; sendMessage({ text }); setInput(""); }

  async function uploadCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setToast("Importing transactions…");
    const body = new FormData(); body.append("file", file);
    const r = await (await fetch("/api/ingest", { method: "POST", body })).json();
    setToast(r.error ? `Error: ${r.error}` : `Imported ${r.inserted} · skipped ${r.skipped?.length ?? 0} · ${r.duplicates} duplicate(s)`);
    e.target.value = ""; loadInsights();
  }
  async function uploadReceipt(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    setToast("Reading receipt…");
    const body = new FormData(); body.append("file", file);
    const r = await (await fetch("/api/receipt", { method: "POST", body })).json();
    e.target.value = "";
    if (r.error) return setToast(`Error: ${r.error}`);
    setToast(""); setReceipt({ id: r.receipt_id, data: r.extracted });
  }
  async function confirmReceipt() {
    if (!receipt) return;
    const res = await fetch("/api/receipt/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receipt_id: receipt.id }) });
    setToast(res.ok ? "Saved to your transactions." : "Could not save receipt.");
    setReceipt(null); loadInsights();
  }
  async function signOut() { await createClient().auth.signOut(); router.push("/login"); router.refresh(); }

  const maxCat = ins?.by_category?.[0]?.spent ?? 1;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div><h1>Ledger</h1><p>your finance assistant</p></div>
        </div>
        <div className="actions">
          <button className="ghost-btn" onClick={() => csvRef.current?.click()}>Upload CSV</button>
          <button className="ghost-btn" onClick={() => imgRef.current?.click()}>Upload receipt</button>
          <button className="ghost-btn icon-btn" onClick={signOut} title="Sign out">↩</button>
          <input ref={csvRef} type="file" accept=".csv" hidden onChange={uploadCsv} />
          <input ref={imgRef} type="file" accept="image/*" hidden onChange={uploadReceipt} />
        </div>
      </header>

      <div className="body">
        <div className="main">
          <div className="thread">
            {toast && <div className="toast">{toast}</div>}
            {messages.length === 0 && !receipt && (
              <div className="empty">
                <h2>Where did your money go?</h2>
                <p className="lead">Ask in plain language, or tap a card on the right. Try:</p>
                <div className="chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
              </div>
            )}
            {messages.map((m) => {
              const text = m.parts.filter((p) => p.type === "text").map((p: { type: string; text?: string }) => p.text).join("");
              return m.role === "user"
                ? <div key={m.id} className="msg user"><div className="bubble">{text}</div></div>
                : <div key={m.id} className="msg ai"><div className="ai-mark">L</div><div className="bubble">{text || <span className="typing"><i /><i /><i /></span>}</div></div>;
            })}
            {busy && messages[messages.length - 1]?.role === "user" && (
              <div className="msg ai"><div className="ai-mark">L</div><div className="bubble"><span className="typing"><i /><i /><i /></span></div></div>
            )}
            {error && (
              <div className="msg ai"><div className="ai-mark">L</div><div className="bubble">{error.message || "Something went wrong. Please try again."}</div></div>
            )}
          </div>

          {receipt && (
            <div className="receipt">
              <div className="head">
                <strong>Confirm this receipt?</strong>
                <span className={`badge ${receipt.data.confidence < 0.5 ? "low" : "ok"}`}>{Math.round(receipt.data.confidence * 100)}% confident</span>
              </div>
              <div className="row mono">{receipt.data.merchant || "Unknown"} · {receipt.data.currency} {fmt(Number(receipt.data.total))} · {receipt.data.txn_date || "no date"} · {receipt.data.category}</div>
              {receipt.data.notes && <div className="note">⚠ {receipt.data.notes}</div>}
              <div className="btns">
                <button className="btn-solid" style={{ height: "auto", padding: "9px 18px" }} onClick={confirmReceipt}>Confirm &amp; save</button>
                <button className="btn-line" onClick={() => setReceipt(null)}>Discard</button>
              </div>
            </div>
          )}

          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <textarea rows={1} value={input} placeholder="Ask about your spending…" onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
            <button className="btn-solid" type="submit" disabled={busy || !input.trim()}>Ask</button>
          </form>
        </div>

        <aside className="rail">
          {!ins || ins.empty ? (
            <p className="rail-empty">Upload a bank statement (CSV) to see your spending broken down here — categories, subscriptions, and anything unusual.</p>
          ) : (
            <>
              <div className="rail-block">
                <h3>Spent · {ins.month}</h3>
                <div className="bignum"><span className="amt">{fmt(ins.total_spend ?? 0)}</span><span className="cur">PKR</span></div>
              </div>

              {!!ins.by_category?.length && (
                <div className="rail-block">
                  <h3>By category</h3>
                  {ins.by_category.slice(0, 6).map((c) => (
                    <div key={c.category} className="barrow" onClick={() => send(`How much did I spend on ${c.category} this month?`)}>
                      <div className="bartop"><b>{c.category}</b><span>{fmt(c.spent)}</span></div>
                      <div className="bartrack"><div className="barfill" style={{ width: `${Math.max(4, (c.spent / maxCat) * 100)}%` }} /></div>
                    </div>
                  ))}
                </div>
              )}

              {(!!ins.anomalies?.length || ins.budgets?.some((b) => b.status !== "ok")) && (
                <div className="rail-block">
                  <h3>Needs attention</h3>
                  {ins.anomalies?.map((a, i) => (
                    <div key={i} className="alert" onClick={() => send(`What is this charge: ${a.transactions?.merchant_normalized ?? ""}?`)}>
                      <span className="dot" /> {a.reason}
                    </div>
                  ))}
                  {ins.budgets?.filter((b) => b.status !== "ok").map((b) => (
                    <div key={b.category} className={`alert ${b.status === "over" ? "over" : ""}`} onClick={() => send(`How is my ${b.category} budget doing?`)}>
                      <span className="dot" /> {b.category} budget {b.pct_used}% used
                    </div>
                  ))}
                </div>
              )}

              {!!ins.recurring?.length && (
                <div className="rail-block">
                  <h3>Subscriptions</h3>
                  {ins.recurring.slice(0, 5).map((r) => (
                    <div key={r.merchant_normalized} className="sub-item"><span>{r.merchant_normalized}</span><b>{fmt(r.typical_amount)}</b></div>
                  ))}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}