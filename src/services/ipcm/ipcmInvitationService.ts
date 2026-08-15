import {
  createHash,
  randomBytes
} from "node:crypto";

import type {
  PoolClient
} from "pg";

import {
  getPool
} from "../../db/pool";

import type {
  IpcmDirectoryItem
} from "../../types/ipcm";

type ActiveIpcmRow = {
  id: string;

  first_name: string;
  last_name: string;

  email: string;
};

type InvitationRow = {
  id: string;

  email: string;

  expires_at: string;

  email_sent_at:
    | string
    | null;

  created_at: string;
};

type ExistingUserRow = {
  id: string;
  company_id: string | null;
};

export type CreatedIpcmInvitation = {
  invitationId: string;

  email: string;

  rawToken: string;

  expiresAt: string;
};

const INVITATION_LIFETIME_DAYS =
  7;

function normalizeEmail(
  email: string
): string {
  return email
    .trim()
    .toLowerCase();
}

function hashToken(
  token: string
): string {
  return createHash(
    "sha256"
  )
    .update(token)
    .digest("hex");
}

function createInvitationToken():
  string {
  return randomBytes(
    32
  ).toString(
    "base64url"
  );
}

function getExpirationDate():
  Date {
  const expiresAt =
    new Date();

  expiresAt.setDate(
    expiresAt.getDate() +
      INVITATION_LIFETIME_DAYS
  );

  return expiresAt;
}

export async function getCompanyIpcmDirectory(
  companyId: string
): Promise<IpcmDirectoryItem[]> {
  const pool =
    getPool();

  const [
    activeUsersResult,
    invitationsResult
  ] =
    await Promise.all([
      pool.query<ActiveIpcmRow>(
        `
          SELECT DISTINCT
            u.id,
            u.first_name,
            u.last_name,
            u.email

          FROM users u

          JOIN user_roles ur
            ON ur.user_id =
              u.id

          JOIN roles r
            ON r.id =
              ur.role_id

          WHERE
            u.company_id = $1

            AND
              u.status =
                'active'

            AND
              r.name =
                'ipcm'

          ORDER BY
            u.last_name,
            u.first_name,
            u.email;
        `,
        [
          companyId
        ]
      ),

      pool.query<InvitationRow>(
        `
          SELECT
            ii.id,
            ii.email,
            ii.expires_at,
            ii.email_sent_at,
            ii.created_at

          FROM ipcm_invitations ii

          WHERE
            ii.company_id = $1

            AND
              ii.accepted_at
                IS NULL

            AND
              ii.revoked_at
                IS NULL

          ORDER BY
            ii.created_at DESC;
        `,
        [
          companyId
        ]
      )
    ]);

  const activeUsers:
    IpcmDirectoryItem[] =
      activeUsersResult.rows.map(
        (row) => ({
          id:
            row.id,

          type:
            "user",

          firstName:
            row.first_name,

          lastName:
            row.last_name,

          email:
            row.email,

          status:
            "active",

          invitationSentAt:
            null,

          invitationExpiresAt:
            null
        })
      );

  const now =
    new Date();

  const invitations:
    IpcmDirectoryItem[] =
      invitationsResult.rows.map(
        (row) => {
          const expiresAt =
            new Date(
              row.expires_at
            );

          return {
            id:
              row.id,

            type:
              "invitation",

            firstName:
              null,

            lastName:
              null,

            email:
              row.email,

            status:
              expiresAt >
              now
                ? "invited"
                : "expired",

            invitationSentAt:
              row.email_sent_at ??
              row.created_at,

            invitationExpiresAt:
              row.expires_at
          };
        }
      );

  return [
    ...activeUsers,
    ...invitations
  ];
}

async function assertEmailAvailable(
  client: PoolClient,
  email: string
): Promise<void> {
  const existingUserResult =
    await client
      .query<ExistingUserRow>(
        `
          SELECT
            id,
            company_id

          FROM users

          WHERE
            LOWER(email) =
              LOWER($1)

          LIMIT 1;
        `,
        [
          email
        ]
      );

  if (
    existingUserResult
      .rowCount &&
    existingUserResult
      .rowCount >
      0
  ) {
    throw new Error(
      "USER_ALREADY_EXISTS"
    );
  }
}

export async function createIpcmInvitation(
  companyId: string,
  createdByUserId: string,
  requestedEmail: string
): Promise<CreatedIpcmInvitation> {
  const email =
    normalizeEmail(
      requestedEmail
    );

  const pool =
    getPool();

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    await assertEmailAvailable(
      client,
      email
    );

    /*
     * A resend always invalidates the previous
     * active invitation for this company/email.
     */
    await client.query(
      `
        UPDATE ipcm_invitations

        SET
          revoked_at =
            CURRENT_TIMESTAMP,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          company_id = $1

          AND
            LOWER(email) =
              LOWER($2)

          AND
            accepted_at
              IS NULL

          AND
            revoked_at
              IS NULL;
      `,
      [
        companyId,
        email
      ]
    );

    const rawToken =
      createInvitationToken();

    const tokenHash =
      hashToken(
        rawToken
      );

    const expirationDate =
      getExpirationDate();

    const insertResult =
      await client.query<{
        id: string;
        expires_at: string;
      }>(
        `
          INSERT INTO ipcm_invitations (
            company_id,
            email,
            token_hash,
            expires_at,
            created_by_user_id
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5
          )
          RETURNING
            id,
            expires_at;
        `,
        [
          companyId,
          email,
          tokenHash,
          expirationDate,
          createdByUserId
        ]
      );

    const invitation =
      insertResult.rows[0];

    if (!invitation) {
      throw new Error(
        "INVITATION_INSERT_FAILED"
      );
    }

    await client.query(
      "COMMIT"
    );

    return {
      invitationId:
        invitation.id,

      email,

      rawToken,

      expiresAt:
        invitation.expires_at
    };
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    throw error;
  } finally {
    client.release();
  }
}

export async function markIpcmInvitationEmailSent(
  invitationId: string
): Promise<void> {
  await getPool().query(
    `
      UPDATE ipcm_invitations

      SET
        email_sent_at =
          CURRENT_TIMESTAMP,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE
        id = $1;
    `,
    [
      invitationId
    ]
  );
}

export async function revokeIpcmInvitation(
  invitationId: string
): Promise<void> {
  await getPool().query(
    `
      UPDATE ipcm_invitations

      SET
        revoked_at =
          CURRENT_TIMESTAMP,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE
        id = $1

        AND
          accepted_at
            IS NULL

        AND
          revoked_at
            IS NULL;
    `,
    [
      invitationId
    ]
  );
}