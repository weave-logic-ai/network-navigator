# Applying 063 to an existing budget volume

Use `psql` against the intended database with a backup and a maintenance window. Do not run paid enrichment while resolving periods. Migration 063 rejects overlaps; it never chooses or deletes a row. The commands below are read-only until the explicit `UPDATE` and `COMMIT`.

List **every** overlapping active pair, including period spend and recorded transactions:

```sql
WITH accounting AS (
  SELECT b.id, b.period_type, b.period_start, b.period_end, b.budget_cents,
         b.spent_cents, b.lookup_count, b.is_active,
         count(t.id) AS transaction_count,
         coalesce(sum(t.cost_cents), 0) AS transaction_cents
  FROM budget_periods b
  LEFT JOIN enrichment_transactions t ON t.budget_period_id = b.id
  GROUP BY b.id
)
SELECT a.id AS first_id, a.period_type AS first_type,
       a.period_start AS first_start, a.period_end AS first_end,
       a.budget_cents AS first_budget, a.spent_cents AS first_spent,
       a.lookup_count AS first_lookups, a.transaction_count AS first_transactions,
       a.transaction_cents AS first_transaction_cents,
       b.id AS second_id, b.period_type AS second_type,
       b.period_start AS second_start, b.period_end AS second_end,
       b.budget_cents AS second_budget, b.spent_cents AS second_spent,
       b.lookup_count AS second_lookups, b.transaction_count AS second_transactions,
       b.transaction_cents AS second_transaction_cents
FROM accounting a JOIN accounting b ON a.id < b.id
WHERE a.is_active AND b.is_active
  AND daterange(a.period_start, a.period_end, '[]') &&
      daterange(b.period_start, b.period_end, '[]')
ORDER BY a.period_start, b.period_start, a.id, b.id;
```

For each connected set of overlaps, select the one policy that was intended to own spending. Compare the displayed spend, lookup count, transaction counts and transaction amounts with provider invoices and the original budget decision. **Do not automatically pick the highest spent row**: transactions can exist on both rows. Record chosen survivor and superseded UUIDs in the change ticket. Investigate any mismatch between `spent_cents` and transactions before changing an active flag. Deactivation preserves the row, its spend and its transaction foreign keys.

Use a transaction to trial the chosen UUIDs. Replace only the UUID literals below. Repeat the pair query above *inside the transaction*; it must return zero rows before committing. If uncertain, use `ROLLBACK` instead of `COMMIT`.

```sql
BEGIN;
LOCK TABLE budget_periods IN SHARE ROW EXCLUSIVE MODE;
SELECT id, period_start, period_end, spent_cents, lookup_count, is_active
FROM budget_periods ORDER BY period_start, id FOR UPDATE;
UPDATE budget_periods SET is_active = false
WHERE id IN ('00000000-0000-0000-0000-000000000001'::uuid)
  AND is_active = true;
-- Paste and run the pair query above here. It must return zero rows.
-- Inspect affected UUIDs and their accounting once more.
COMMIT;
```

Apply and repeat migration from the repository root; `ON_ERROR_STOP` prevents a false success:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f data/db/init/063-enrichment-budget-exclusion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f data/db/init/063-enrichment-budget-exclusion.sql
```

Verify the pair query returns zero rows, `budget_periods_active_no_overlap` exists in `pg_constraint`, and all original budget IDs and transaction IDs/counts remain. Migration 063 also replaces migration 012's transaction status check to admit `reconciled`; verify `enrichment_transactions_status_check` admits that value and still rejects unknown statuses. To undo a pre-commit decision, `ROLLBACK`. After commit, reverse only the chosen flags in a new transaction after checking that reactivation will not overlap an active period. The exclusion constraint intentionally rejects an unsafe reversal; never drop it to force one.

A quote with `enrichment_quote_uses.pending IS NOT NULL` needs provider invoice reconciliation before another paid preview for that contact. Preserve the quote row, returned `results`, and its `enrichment_provider_claims` receipt; do not delete them or reuse the quote. A completed paid lookup remains claimed; a confirmed zero-cost no-match releases its claim only after the result and ledger settle together. There is no automatic paid retry for an unknown charge.

For an unknown charge, open **Enrichment → Charges requiring reconciliation**. The queue shows attempts explicitly flagged by the provider path, plus stale pending attempts after 15 minutes. Check the provider invoice and any request reference. Record the quote UUID, provider, contact UUID, reserved cents, invoice/reference and actual billed cents in the change ticket. Enter the verified billed amount in **cents** and the invoice reference, then confirm **Record verified charge**. The operator API rejects amounts above the reservation; it atomically releases unused reserved cents, writes one `reconciled` transaction, stores the reference and amount on the quote, and clears the pending marker. It retains the provider claim even for a zero bill because the prior request's outcome was uncertain. A second settlement of that quote is rejected. Recover the original quote to review saved fields; quote the remaining contacts separately after reviewing the partial batch. No provider call occurs during reconciliation. Keep the contact blocked while the invoice is unknown.

If the original preview response was interrupted, recovering the same quote saves a provisional review response from already recorded provider results. It makes those fields available to Apply. The original request can still finish and replace the provisional response; recovery itself never starts a provider lookup. A provisional recovery with no pending charge must not be reported as requiring reconciliation.

If the invoice exceeds the reservation, the provider record is missing, or the ledger disagrees with the invoice, stop and investigate manually. Do not enter a smaller amount to force settlement. The quote remains pending and blocked until its accounting is resolved. Review `enrichment_quote_uses`, `enrichment_provider_claims`, `enrichment_transactions`, and `budget_periods` with the invoice before any manual change. Never reset a quote ID or erase saved fields.
