import {
  getPool
} from "../../db/pool";

type IpcmRemovalRow = {
  id: string;
  email: string;

  case_count: number;
  trip_count: number;
};

export type IpcmRemovalCandidate = {
  id: string;
  email: string;

  caseCount: number;
  tripCount: number;
};

export async function getIpcmRemovalCandidate(
  companyId: string,
  userId: string
): Promise<IpcmRemovalCandidate | null> {
  const result =
    await getPool()
      .query<IpcmRemovalRow>(
        `
          SELECT
            u.id,
            u.email,

            (
              SELECT
                COUNT(*)::int

              FROM cases c

              WHERE
                c.ipcm_user_id =
                  u.id
            ) AS case_count,

            (
              SELECT
                COUNT(*)::int

              FROM trips t

              WHERE
                t.ipcm_user_id =
                  u.id
            ) AS trip_count

          FROM users u

          JOIN user_roles ur
            ON ur.user_id =
              u.id

          JOIN roles r
            ON r.id =
              ur.role_id

          WHERE
            u.id = $1

            AND
              u.company_id = $2

            AND
              u.status =
                'active'

            AND
              r.name =
                'ipcm'

          LIMIT 1;
        `,
        [
          userId,
          companyId
        ]
      );

  const row =
    result.rows[0];

  if (!row) {
    return null;
  }

  return {
    id:
      row.id,

    email:
      row.email,

    caseCount:
      Number(
        row.case_count
      ),

    tripCount:
      Number(
        row.trip_count
      )
  };
}

export async function deactivateIpcmUser(
  companyId: string,
  userId: string
): Promise<boolean> {
  const pool =
    getPool();

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    await client.query(
      `
        UPDATE ipcm_payment_methods

        SET
          status =
            'inactive',

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          user_id = $1

          AND
            company_id = $2;
      `,
      [
        userId,
        companyId
      ]
    );

    const result =
      await client.query(
        `
          UPDATE users

          SET
            status =
              'inactive',

            updated_at =
              CURRENT_TIMESTAMP

          WHERE
            id = $1

            AND
              company_id = $2

            AND
              status =
                'active'

          RETURNING id;
        `,
        [
          userId,
          companyId
        ]
      );

    if (
      (result.rowCount ??
        0) ===
      0
    ) {
      await client.query(
        "ROLLBACK"
      );

      return false;
    }

    await client.query(
      "COMMIT"
    );

    return true;
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}