import type { PoolClient } from "pg";
import type { CurrentUser } from "./currentUser";

export type AuthorizedCase = { id: string; case_manager_user_id: string };

export async function getAuthorizedCase(
  client: PoolClient, user: CurrentUser, caseId: string
): Promise<AuthorizedCase | null> {
  const result = await client.query<AuthorizedCase>(`
    SELECT c.id, c.case_manager_user_id FROM cases c
    WHERE c.id = $1 AND c.company_id = $2
      AND ($3 = 'admin' OR c.case_manager_user_id = $4)
    FOR UPDATE OF c
  `, [caseId, user.companyId, user.roleName, user.id]);
  return result.rows[0] ?? null;
}

export async function isCaseTraveler(
  client: PoolClient, companyId: string, caseId: string, travelerId: string
): Promise<boolean> {
  const result = await client.query(`
    SELECT 1 FROM case_travelers ct
    JOIN traveler_profiles tp ON tp.id = ct.traveler_profile_id
    WHERE ct.case_id = $1 AND ct.traveler_profile_id = $2
      AND tp.company_id = $3 AND tp.status = 'active'
    LIMIT 1
  `, [caseId, travelerId, companyId]);
  return (result.rowCount ?? 0) > 0;
}
