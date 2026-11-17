import type { PoolClient } from "pg";

/** Call with the relevant cases row locked FOR UPDATE in the same transaction. */
export async function rebalanceCaseTripBudgets(client: PoolClient, caseId: string): Promise<void> {
  const caseResult = await client.query<{ approved_budget_cents: number | null }>(
    `SELECT approved_budget_cents FROM cases WHERE id = $1`, [caseId]
  );
  if (!caseResult.rowCount) throw new Error("Case not found during budget allocation.");
  const approved = caseResult.rows[0].approved_budget_cents;
  const result = await client.query<{ id: string; budget_filter: number | null; budget_is_manual: boolean }>(
    `SELECT id, budget_filter, budget_is_manual FROM trips WHERE case_id = $1 ORDER BY created_at, id FOR UPDATE`,
    [caseId]
  );
  const manual = result.rows.filter((trip) => trip.budget_is_manual);
  const automatic = result.rows.filter((trip) => !trip.budget_is_manual);
  const manualTotal = manual.reduce((total, trip) => total + Number(trip.budget_filter ?? 0), 0);
  if (!Number.isSafeInteger(manualTotal) || manualTotal < 0) throw new Error("Invalid manual trip budget.");
  if (approved === null) {
    // No approved case budget: automatic trips have no allocation yet.
    await client.query(`UPDATE trips SET budget_filter = NULL, updated_at = CURRENT_TIMESTAMP WHERE case_id = $1 AND budget_is_manual = FALSE`, [caseId]);
    return;
  }
  const approvedCents = Number(approved);
  if (!Number.isSafeInteger(approvedCents) || approvedCents < 0) throw new Error("Invalid approved case budget.");
  if (manualTotal > approvedCents) throw new Error("Manual trip budgets exceed the approved case budget.");
  if (!automatic.length) return; // Any unallocated amount remains at case level.
  const remainder = approvedCents - manualTotal;
  const base = Math.floor(remainder / automatic.length);
  const extra = remainder % automatic.length;
  for (const [index, trip] of automatic.entries()) {
    await client.query(
      `UPDATE trips SET budget_filter = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [base + (index < extra ? 1 : 0), trip.id]
    );
  }
}
