-- ============================================================================
-- INSIGHTS: deterministic pre-computation. These run in Postgres (no LLM) and
-- are called once after each CSV ingest. The assistant later just READS the
-- recurring_charges / anomalies tables — cheap, fast, and scalable. Run this in
-- the Supabase SQL editor after schema.sql + functions.sql.
-- ============================================================================

-- Recurring SUBSCRIPTIONS: a merchant charged >= 3 times, at a regular cadence,
-- with a NEAR-CONSTANT amount. The stddev filter is what separates a real
-- subscription (Netflix, rent) from merely frequent spend (groceries vary).
create or replace function refresh_recurring() returns void
language plpgsql security invoker as $$
begin
  delete from recurring_charges where user_id = auth.uid();
  insert into recurring_charges
    (user_id, merchant_normalized, typical_amount, cadence, occurrences, last_seen, next_expected, confidence)
  select auth.uid(), s.merchant_normalized, s.typical_amount,
    case when s.avg_gap between 5 and 9   then 'weekly'
         when s.avg_gap between 25 and 35 then 'monthly'
         when s.avg_gap between 350 and 380 then 'annual'
         else 'irregular' end,
    s.cnt, s.last_seen,
    (case when s.avg_gap between 25 and 35 then s.last_seen + interval '1 month'
          when s.avg_gap between 5 and 9   then s.last_seen + interval '7 days'
          else null end)::date,
    least(1.0, s.cnt / 6.0)
  from (
    select merchant_normalized,
           count(*)                                                   as cnt,
           round(avg(abs(amount)), 2)                                 as typical_amount,
           coalesce(stddev_samp(abs(amount)), 0)                      as sd,
           max(txn_date)                                              as last_seen,
           (max(txn_date) - min(txn_date))::numeric
             / nullif(count(*) - 1, 0)                                as avg_gap
    from transactions
    where user_id = auth.uid() and amount < 0 and merchant_normalized is not null
    group by merchant_normalized
    having count(*) >= 3
  ) s
  where s.avg_gap between 5 and 380
    and s.sd <= 0.10 * s.typical_amount;   -- near-constant => true subscription
end; $$;

-- Anomalies: a charge far above this user's typical for its category. Uses a
-- MEDIAN MULTIPLE (robust for small per-category samples, where a z-score is
-- dominated by the outlier itself). Floor avoids flagging trivially small cats.
create or replace function refresh_anomalies() returns void
language plpgsql security invoker as $$
begin
  delete from anomalies where user_id = auth.uid();
  insert into anomalies (user_id, txn_id, reason, score)
  select auth.uid(), t.id,
    'Unusually large ' || t.category || ' charge — ~'
      || round(abs(t.amount) / m.med, 1) || 'x your typical ' || t.category,
    round(abs(t.amount) / m.med, 2)
  from transactions t
  join (
    select category,
           percentile_cont(0.5) within group (order by abs(amount)) as med
    from transactions
    where user_id = auth.uid() and amount < 0
    group by category
  ) m on m.category = t.category
  where t.user_id = auth.uid() and t.amount < 0
    and m.med > 0
    and abs(t.amount) >= 5 * m.med
    and abs(t.amount) >= 20000;
end; $$;

grant execute on function refresh_recurring() to authenticated;
grant execute on function refresh_anomalies() to authenticated;
