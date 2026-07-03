import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCognitoClaims } from "../common/auth";
import { jsonResponse } from "../common/response";

type CurrentUserRow = {
  id: string;
  company_id: string | null;
  role_name: string;
};

type CaseRow = {
  id: string;
  case_reference_id: string;
  case_manager_first_name: string;
  case_manager_last_name: string;
  ipcm_first_name: string | null;
  ipcm_last_name: string | null;
  status: string;
};

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const claims = getCognitoClaims(event);
    const pool = getPool();

    const currentUserResult = await pool.query<CurrentUserRow>(
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

    if (currentUserResult.rowCount === 0) {
      return jsonResponse(403, {
        message: "Authenticated user does not exist in Aurem database."
      });
    }

    const currentUser = currentUserResult.rows[0];

    let whereClause = "";
    const params: string[] = [];

    if (currentUser.role_name === "admin") {
      whereClause = "cm.company_id = $1";
      params.push(currentUser.company_id ?? "");
    } else if (currentUser.role_name === "case_manager") {
      whereClause = "c.case_manager_user_id = $1";
      params.push(currentUser.id);
    } else if (currentUser.role_name === "ipcm") {
      whereClause = "c.ip_user_id = $1";
      params.push(currentUser.id);
    } else {
      return jsonResponse(403, {
        message: "User role is not authorized to view cases."
      });
    }

    const casesResult = await pool.query<CaseRow>(
      `
      SELECT
        c.id,
        c.case_reference_id,
        cm.first_name AS case_manager_first_name,
        cm.last_name AS case_manager_last_name,
        ip.first_name AS ipcm_first_name,
        ip.last_name AS ipcm_last_name,
        c.status
      FROM cases c
      JOIN users cm ON cm.id = c.case_manager_user_id
      LEFT JOIN users ip ON ip.id = c.ip_user_id
      WHERE ${whereClause}
      ORDER BY c.created_at DESC;
      `,
      params
    );

    return jsonResponse(200, {
      cases: casesResult.rows.map((row) => ({
        id: row.id,
        caseReferenceId: row.case_reference_id,
        caseManagerName: `${row.case_manager_first_name} ${row.case_manager_last_name}`,
        ipcmName:
          row.ipcm_first_name && row.ipcm_last_name
            ? `${row.ipcm_first_name} ${row.ipcm_last_name}`
            : "Unassigned",
        status: row.status
      }))
    });
  } catch (error) {
    console.error("GET /cases error", error);

    return jsonResponse(500, {
      message: "Unable to load cases."
    });
  }
}