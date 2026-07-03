import type { APIGatewayProxyEvent } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCognitoClaims } from "./auth";

export type CurrentUser = {
  id: string;
  companyId: string;
  roleName: string;
};

export async function getCurrentUser(event: APIGatewayProxyEvent): Promise<CurrentUser | null> {
  const claims = getCognitoClaims(event);
  const pool = getPool();

  const result = await pool.query(
    `
    SELECT
      u.id,
      u.company_id,
      r.name AS role_name
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE u.cognito_user_id = $1
      AND u.status = 'active'
    LIMIT 1;
    `,
    [claims.sub]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return {
    id: result.rows[0].id,
    companyId: result.rows[0].company_id,
    roleName: result.rows[0].role_name
  };
}

export function assertAdminOrCaseManager(user: CurrentUser): void {
  if (!["admin", "case_manager"].includes(user.roleName)) {
    throw new Error("FORBIDDEN");
  }
}