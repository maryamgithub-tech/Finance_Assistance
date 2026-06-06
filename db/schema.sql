-- ============================================================================
-- Personal Finance Assistant — Postgres schema (Supabase)
-- ----------------------------------------------------------------------------
-- DESIGN PRINCIPLE: Postgres is the source of truth and the calculator.
-- The LLM NEVER reads raw transaction rows. It calls tools that run the
-- aggregations below and return small results. This is what keeps the system
-- fast, cheap, and correct whether a user has 1 month or 10 years of history.
--
-- Every table is scoped by user_id and protected by Row Level Security (RLS)
-- so one user can never see another user's data — required by the brief's
-- "each user's financial data is private to them".
-- ============================================================================

-- Supabase provides auth.users. We keep an app-level profile table linked to it.
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- TRANSACTIONS — the core table. Indexed for fast per-user, per-period,
-- per-category aggregation. The `dedupe_hash` makes ingestion idempotent so
-- re-uploading a CSV (or overlapping date ranges) never creates duplicates
-- (brief: "a transaction dataset with duplicates").
-- ---------------------------------------------------------------------------
create table if not exists transactions (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  txn_date            date not null,
  amount              numeric(14,2) not null,          -- negative = spend, positive = income
  currency            text not null default 'PKR',
  merchant_raw        text,                            -- as it appeared in the source
  merchant_normalized text,                            -- cleaned for matching/grouping
  category            text,                            -- assigned at ingest, not by the LLM per-query
  description         text,
  source              text not null default 'csv',     -- 'csv' | 'bank_mock' | 'receipt'
  dedupe_hash         text not null,                   -- hash(user, date, amount, merchant_raw)
  created_at          timestamptz not null default now(),
  unique (user_id, dedupe_hash)
);

create index if not exists idx_txn_user_date     on transactions (user_id, txn_date desc);
create index if not exists idx_txn_user_cat_date  on transactions (user_id, category, txn_date desc);
create index if not exists idx_txn_user_merchant  on transactions (user_id, merchant_normalized);

-- ---------------------------------------------------------------------------
-- BUDGETS — user-set limits the assistant tracks and warns against.
-- ---------------------------------------------------------------------------
create table if not exists budgets (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  category    text not null,
  period      text not null default 'monthly',         -- 'monthly' for the slice
  limit_amount numeric(14,2) not null,
  created_at  timestamptz not null default now(),
  unique (user_id, category, period)
);

-- ---------------------------------------------------------------------------
-- USER_FACTS — durable memory. "I get paid on the 1st", "don't count rent in
-- my food budget". Stored as STRUCTURED rules, not freeform chat we re-read
-- every turn. The assistant interprets a sentence into one of these and later
-- applies it as a query filter / context line.
-- ---------------------------------------------------------------------------
create table if not exists user_facts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  fact_type   text not null,        -- 'payday' | 'exclude_category_from_budget' | 'note' ...
  payload     jsonb not null,       -- e.g. {"day": 1} or {"exclude":"rent","from":"food"}
  raw_text    text,                 -- the original sentence, for transparency
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RECURRING_CHARGES — PRE-COMPUTED on ingest by deterministic SQL/stats,
-- NOT by the LLM per request. The assistant just reads this table. This is a
-- deliberate "don't use the model where it's overkill" decision.
-- ---------------------------------------------------------------------------
create table if not exists recurring_charges (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  merchant_normalized text not null,
  typical_amount      numeric(14,2),
  cadence             text,                 -- 'monthly' | 'weekly' | 'annual'
  occurrences         int,
  last_seen           date,
  next_expected       date,
  confidence          numeric(3,2),         -- 0..1
  updated_at          timestamptz not null default now(),
  unique (user_id, merchant_normalized, cadence)
);

-- ---------------------------------------------------------------------------
-- ANOMALIES — also PRE-COMPUTED (statistical, e.g. amount far above this
-- user's own history for that merchant/category). The assistant reads these.
-- ---------------------------------------------------------------------------
create table if not exists anomalies (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  txn_id      bigint references transactions(id) on delete cascade,
  reason      text,                 -- human-readable why-flagged
  score       numeric,              -- e.g. z-score
  acknowledged boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RECEIPTS — uploaded images parsed by a multimodal model into structured
-- fields. `status` lets us hold low-confidence parses for user confirmation
-- instead of silently inserting a wrong expense (brief: blurry/rotated/foreign).
-- ---------------------------------------------------------------------------
create table if not exists receipts (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  image_path          text,                 -- Supabase Storage ref
  extracted           jsonb,                -- {merchant, total, date, line_items[]}
  confidence          numeric(3,2),
  status              text not null default 'pending',  -- 'pending' | 'confirmed' | 'rejected'
  linked_txn_id       bigint references transactions(id) on delete set null,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY — every table: a user can only touch their own rows.
-- ---------------------------------------------------------------------------
alter table profiles          enable row level security;
alter table transactions      enable row level security;
alter table budgets           enable row level security;
alter table user_facts        enable row level security;
alter table recurring_charges enable row level security;
alter table anomalies         enable row level security;
alter table receipts          enable row level security;

-- One representative policy; the rest follow the same pattern (created in migration).
create policy "own rows" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
