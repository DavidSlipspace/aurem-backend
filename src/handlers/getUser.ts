import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCognitoClaims } from "../common/auth";
import { jsonResponse } from "../common/response";

type UserRow = { first_name: string; last_name: string; email: string; role_name: string; role_display_name: string };

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const claims = getCognitoClaims(event);
    const result = await getPool().query<UserRow>(`
      SELECT u.first_name, u.last_name, u.email, r.name AS role_name,
        r.display_name AS role_display_name
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.cognito_user_id = $1 AND u.status = 'active'
      ORDER BY CASE r.name WHEN 'admin' THEN 1 WHEN 'case_manager' THEN 2 WHEN 'ipcm' THEN 3 ELSE 99 END
      LIMIT 1
    `, [claims.sub]);
    const user = result.rows[0];
    if (!user) return jsonResponse(403, { message: "Authenticated user does not exist in Orvo database." });
    const role = ["ipcm", "case_manager"].includes(user.role_name) ? "Case Manager" : user.role_display_name;
    return jsonResponse(200, {
      email: user.email, firstName: user.first_name, lastName: user.last_name,
      role, welcomeMessage: `Welcome ${role}, ${user.first_name}`
    });
  } catch (error) {
    console.error("GET /getUser error", error);
    return jsonResponse(500, { message: "Unable to load current user." });
  }
}
