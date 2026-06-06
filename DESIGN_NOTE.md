# Ledger — Personal Finance Assistant: Design Note

**Core idea (the one decision everything rests on):** the LLM never sees raw
transaction rows. Postgres is the source of truth and the calculator; the model
is an orchestrator that calls typed tools which run SQL and return small results.
So a query costs a few hundred to ~2,000 tokens whether the user has 100
transactions or 10 million — token cost and latency stay flat as history grows,
which is the property the brief's "10×–100× larger data" requirement tests.

Stack: Next.js (TypeScript) + Vercel AI SDK + Supabase (Postgres + Auth) +
Gemini (free tier). Auth and DB hosting are bought; effort went into the hard
parts — context strategy, routing, tool design, and edge handling.

## 1. Features covered & completion level

All ten requested capabilities work end-to-end, plus receipt extraction:

- Spending Q&A ("how much on dining in March") — SQL aggregate via tool.
- Biggest/largest purchases — bounded top-N lookup.
- Recurring subscriptions — pre-detected, read from a table.
- Unusual-activity flagging — pre-detected anomalies.
- "Am I spending more than usual" — latest month vs trailing 3-month average.
- Budgets — set a limit, track spend vs limit, warn at ≥80% / ≥100%.
- Unfamiliar charge lookup — web search via Gemini grounding, with sources.
- Plain-English summary and cut-back suggestions — model reasons over aggregates.
- Durable memory ("I get paid on the 1st") — stored as structured rules, applied
  on every later turn.
- Receipt photo → extracted fields → confirm → transaction.

UI: a two-pane product — chat plus a live insights dashboard (month spend,
category bars, anomaly/budget alerts, subscriptions). Dashboard items are
clickable and feed the chat. Multi-user with per-user data isolation.

Completion: the full path (auth → ingest → ask → answer) is real and working.
Everything is wired to a live database, not mocked.

## 2. Key architectural & technical decisions (and why)

**LLM-as-conductor, tools-over-SQL.** The model reads intent and calls tools
(`querySpending`, `topTransactions`, `comparePeriods`, `listRecurring`,
`listAnomalies`, budgets, `rememberFact`, `lookupMerchant`). Aggregation runs in
Postgres via an RPC scoped by `auth.uid()`. This is what makes the system scale
and stops the model hallucinating numbers — it must call a tool or say it cannot.

**Cheap-vs-agentic routing.** A lightweight heuristic classifies each message.
Simple lookups use a cheap, fast model (Gemini Flash-Lite) and one tool call;
genuine multi-step work (comparison, web lookup, cut-back advice) escalates to a
more capable model with more steps allowed. Model names are env-config, so the
provider can be swapped without code changes. Every turn logs path + model +
token usage, so cost is measured, not assumed.

**Deterministic pre-computation, not LLM.** Recurring detection and anomaly
flagging run as SQL on ingest, and the assistant just reads the results — cheaper,
faster, and scalable. Recurring uses a standard-deviation filter so a true
subscription (near-constant amount, e.g. Netflix/rent) is separated from merely
frequent spend (groceries vary). Anomalies use a median-multiple rather than a
z-score, deliberately, because with few transactions per category a z-score is
dominated by the outlier itself.

**Memory: write-via-tool, apply-via-prompt-injection.** `rememberFact` persists a
structured rule; every later turn injects the user's facts into the system
prompt, so preferences actually persist instead of being re-derived.

**Column-flexible ingest.** The CSV parser maps columns by keyword, so it accepts
both separate Debit/Credit columns and a single signed Amount column, strips
"Rs"/"PKR" and thousands separators, handles parentheses-negatives and several
date formats, and dedupes idempotently via a per-row hash. A brand-new bank's
export works with zero code changes.

**Multi-tenant isolation.** Row Level Security on every table; a user can only
ever touch their own rows, enforced at the database, independent of app code.

## 3. Assumptions, trade-offs & limitations

- Single currency (PKR). Multi-currency would need FX handling.
- Dates are read day-first (Pakistani convention); a US-format file would misparse.
- "This month" means the month of the latest transaction, not today — correct for
  statement-style historical data.
- Merchant normalization is heuristic and imperfect (some reference noise survives);
  it doesn't affect categories, which drive the spending math.
- Categorization is rule/keyword-based, so unseen merchants fall to "Uncategorized"
  until a rule is added. An LLM pass over only that long tail is the upgrade path.
- Receipts store extracted fields, not the image file.
- Runs on Gemini's free tier (low daily request cap; prompts may be used for
  training). Production would use the paid tier or Vertex AI — no training on data
  and far higher limits. The architecture is unchanged either way.

## 4. What was intentionally skipped / stubbed

- Real bank connectivity — the "mock bank endpoint" is represented by CSV upload.
- 100k+-row ingest at once — inserts are batched (500/chunk), which handles
  thousands reliably; truly huge files would want a streaming/queue pipeline.
- Multi-currency, receipt-image storage, and a full charts page (the dashboard
  uses simple bars) were skipped to spend time on the harder reasoning parts.
- Automated tests were not included; the ingest pipeline was verified by running it
  against deliberately messy fixtures (results inspected by hand).

## 5. Challenges faced & how handled

- **AI SDK had recently changed** (tools use `inputSchema`, responses use
  `toUIMessageStreamResponse`, messages go through `convertToModelMessages`). I
  verified the current API against the official docs rather than relying on memory.
- **RLS gaps caused silent failures.** Enabling Row Level Security without policies
  denies all access by default, which quietly broke receipt inserts and the
  recurring/anomaly pre-compute. Fixed by adding an explicit per-table "own rows"
  policy. Good reminder that "secure by default" can fail closed.
- **Provider/model mismatch.** An old Claude model string was being sent to the
  Google API. Resolved by making model tiers env-config with correct defaults.
- **Relative dates vs historical data** and **small-sample anomaly detection** were
  both handled by choosing approaches that fit the actual data (latest-month
  anchoring; median-multiple over z-score).
- **Free-tier rate limits.** The chat now catches a 429 and shows a calm "limit
  reached, try later" message instead of a hard error — the kind of expensive/slow
  request the brief asks to handle gracefully.

## 6. Thinking process & decision rationale

The brief rewards judgement, not feature count, so I optimised for the graded
axes. The central judgement was recognising the listed capabilities are *not the
same kind of work*: a spend total is a cheap SQL sum; "what is this charge" needs
the web; a receipt needs vision; "more than usual" needs multi-step reasoning. I
matched effort to each — cheap model + one tool for lookups, escalation only when
warranted — and pushed everything that doesn't need an LLM (math, detection) into
Postgres. That single split is what satisfies *fast*, *economical*, and *scales*
simultaneously.

I deliberately chose depth over breadth: a narrow path that genuinely works,
handles messy input, and degrades gracefully (asks when ambiguous, says "I don't
know" instead of inventing numbers) beats a broad set of brittle features. I built
so that adding a capability is one new tool behind the router rather than a
refactor — and proved that adaptability by adding support for a second, differently
formatted bank export with no change to the rest of the system. Where I simplified,
I said so here rather than hiding it, because being able to defend the trade-offs is
the point.
  