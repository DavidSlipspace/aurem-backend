import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCognitoClaims } from "../common/auth";
import { jsonResponse } from "../common/response";

type UserRow = {
  first_name: string;
  last_name: string;
  email: string;
  role_display_name: string;
};

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const claims = getCognitoClaims(event);

    const pool = getPool();

    const result = await pool.query<UserRow>(
      `
      SELECT
        u.first_name,
        u.last_name,
        u.email,
        r.display_name AS role_display_name
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
      return jsonResponse(403, {
        message: "Authenticated user does not exist in Aurem database."
      });
    }

    const user = result.rows[0];

    return jsonResponse(200, {
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.role_display_name,
      welcomeUserssage: `Welcome ${user.role_display_name}, ${user.first_name}`
    });
  } catch (error) {
    console.error("GET /user error", error);

    return jsonResponse(500, {
      message: "Unable to load current user."
    });
  }
}