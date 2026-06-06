# Personal Finance Assistant

An AI financial companion: log in, bring in your transaction history, and ask
about your money in plain language (and by photo of a receipt).

> Built for the Revonix Full-Stack AI Engineer take-home. This README **is** the
> design note. It is written as the project is built, not reconstructed after.

---

## TL;DR — the one decision everything hangs on

**The LLM never sees a transaction row.** Postgres is the source of truth and
the calculator; the model is a conductor that calls typed tools which run SQL
and return small results. Token cost and latency are therefore **flat** whether
a user has one month or ten years of history — which is the core scaling test
the brief sets ("assume the data could be 10×–100× larger").

```
User ── chat ──▶ Router ──▶ cheap model (default)        ┐
                  │          capable model (multi-step)  ├─▶ Tools ─▶ Postgres (SUM/GROUP BY,
                  │          vision model (receipts)      ┘            pre-computed tables)
                  └─ logs path + model + tokens + est. cost
```

---

## Stack (and why)

| Concern | Choice | Why |
|---|---|---|
| App + API | Next.js (TypeScript) | One repo, one deploy; API routes co-located with UI |
| Chat / tools | Vercel AI SDK | Streaming + function-calling out of the box — no custom plumbing |
| Auth | Supabase Auth | Commodity work; the brief says buy, don't build |
| Data | Supabase Postgres + RLS | SQL does the math; Row Level Security keeps each user's data private |
| Models | tiered (cheap / capable / vision) | Match effort to task under the cost + speed constraints |

Build-vs-buy line: auth and DB hosting are bought; the **hard parts** (context
strategy, routing, tool design, edge handling) are where the effort went.

---

## How each requested capability is handled — and what kind of work it is

| Capability | Path | Mechanism |
|---|---|---|
| Spending Q&A ("how much on groceries") | cheap | one `querySpending` SQL aggregate |
| Biggest purchase in March | cheap | `topTransactions` bounded lookup |
| Recurring subscriptions | cheap read | **pre-computed** table, not LLM detection |
| Unusual activity | cheap read | **pre-computed** statistical flags |
| "More than usual?" | agentic | `comparePeriods` vs trailing baseline, model interprets |
| Budget tracking + warnings | cheap | `getBudgetStatus` / `setBudget` |
| Unfamiliar charge | agentic | `lookupMerchant` → web search → synthesise |
| Plain-English summary | agentic | a few aggregates → model phrases |
| Where to cut back | agentic | aggregates → model proposes, numbers-backed |
| Remember context | write | `rememberFact` → structured rule in `user_facts` |
| Receipt photo | vision | multimodal extract → confirm if low confidence |

The point the brief is testing: **these are not the same kind of work.** Cheap
lookups get a cheap model and one tool call; only genuine multi-step work pays
for the capable model.

---

## Edge cases handled (the brief's "expect the unexpected")

- **Messy CSV** — dedupe via per-row hash (idempotent ingest), drop/repair junk
  rows, tolerate missing fields. _[fill in as built]_
- **Blurry / rotated / foreign receipt** — parse with confidence; low confidence
  → held as `pending` and the user is asked to confirm, never silently inserted.
- **Ambiguous question** — assistant asks one clarifying question instead of guessing.
- **Unanswerable from data** — says so plainly rather than inventing a number.
- **Contradictory sources** — surfaces both rather than silently picking.
- **Slow/expensive-if-naive request** — routed away from dumping rows into context.

---

## Cost & latency (measured, not assumed)

_Filled from request logs. Placeholder shape:_

| Query type | Path | Model | ~Input tok | ~Cost | ~Latency |
|---|---|---|---|---|---|
| "How much on groceries last month" | cheap | flash-lite | ~700 | ~$0.0001 | _tbd_ |
| "Am I spending more than usual" | agentic | sonnet | ~1.5k | _tbd_ | _tbd_ |

What happens at 100× data: **nothing changes** — aggregation stays in Postgres.

---

## Required design-note sections

### Features covered & completion level
_[what genuinely works end-to-end vs partial]_

### Key architectural & technical decisions (and why)
- LLM-as-conductor / tools-over-SQL (above).
- Tiered model routing with logged decisions.
- Pre-computed recurring + anomaly detection (deterministic, not LLM).
- Structured `user_facts` memory rather than re-reading chat history.

### Assumptions, trade-offs & limitations
_[e.g. single currency for the slice; monthly budgets only; …]_

### What was intentionally skipped / stubbed
- Mock bank endpoint faked by the CSV.
- _[…]_

### Challenges faced & how they were handled
_[…]_

### Thinking process & decision rationale
_[the why behind the calls above — this is what they read most closely]_

---

## Running it locally
_[setup steps: env vars, supabase project, schema migration, seed CSV — filled in once the app boots]_
