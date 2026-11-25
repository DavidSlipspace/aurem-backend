import {
  getPool
} from "../../db/pool";

type IpcmRemovalRow = {
  id: string;
  email: string;


  trip_count: number;
};

export type IpcmRemovalCandidate = {
  id: string;
  email: string;


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

              FROM trips t

              WHERE
                (t.case_manager_user_id = u.id OR t.approving_case_manager_user_id = u.id)
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
              r.name IN ('ipcm','case_manager')

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

    await client.query(`SELECT id FROM users WHERE id=$1 AND company_id=$2 FOR UPDATE`, [userId,companyId]);
    const assigned = await client.query(`SELECT 1 FROM trips WHERE case_manager_user_id=$1 OR approving_case_manager_user_id=$1 LIMIT 1`,[userId]);
    if (assigned.rowCount) { await client.query("ROLLBACK"); return false; }
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