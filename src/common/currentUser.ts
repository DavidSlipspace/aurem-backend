import type {
  APIGatewayProxyEvent
} from "aws-lambda";

import {
  getPool
} from "../db/pool";

import {
  getCognitoClaims
} from "./auth";

export type CurrentUser = {
  id: string;

  companyId: string;

  roleName: string;
};

export async function getCurrentUser(
  event:
    APIGatewayProxyEvent
): Promise<
  CurrentUser |
  null
> {
  const claims =
    getCognitoClaims(
      event
    );

  const pool =
    getPool();

  const result =
    await pool.query(
      `
      SELECT
        u.id,
        u.company_id,
        r.name AS role_name

      FROM users u

      JOIN user_roles ur
        ON ur.user_id =
          u.id

      JOIN roles r
        ON r.id =
          ur.role_id

      WHERE
        u.cognito_user_id = $1

        AND
        u.status = 'active'

      ORDER BY
        CASE r.name
          WHEN 'admin'
            THEN 1

          WHEN 'case_manager'
            THEN 2

          WHEN 'ipcm'
            THEN 3

          ELSE 99
        END

      LIMIT 1;
      `,
      [
        claims.sub
      ]
    );

  if (
    result.rowCount ===
    0
  ) {
    return null;
  }

  const row =
    result.rows[0];

  if (
    !row.company_id
  ) {
    return null;
  }

  return {
    id:
      row.id,

    companyId:
      row.company_id,

    roleName:
      row.role_name
  };
}

export function assertAdminOrCaseManager(
  user:
    CurrentUser
): void {
  if (
    ![
      "admin",
      "case_manager"
    ].includes(
      user.roleName
    )
  ) {
    throw new Error(
      "FORBIDDEN"
    );
  }
}