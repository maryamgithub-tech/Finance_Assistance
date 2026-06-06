-- ============================================================================
-- Aggregation functions (RPC). The SUM runs in Postgres, not in app memory and
-- not in the model. auth.uid() scopes every call to the signed-in user, so the
-- function is safe to expose to the `authenticated` role. Run this in the
-- Supabase SQL editor after schema.sql.
-- ============================================================================

create or replace function query_spending(
  p_category text default null,
  p_merchant text default null,
  p_start    date default null,
  p_end      date default null
) returns numeric
language sql
stable
security invoker
as $$
  select coalesce(sum(abs(amount)), 0)
  from transactions
  where user_id = auth.uid()
    and amount < 0                                   -- spend only
    and (p_category is null or category ilike p_category)
    and (p_merchant is null or merchant_normalized ilike '%' || p_merchant || '%')
    and (p_start is null or txn_date >= p_start)
    and (p_end   is null or txn_date <= p_end);
$$;

grant execute on function query_spending(text, text, date, date) to authenticated;
