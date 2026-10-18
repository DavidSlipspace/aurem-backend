import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  createHash
} from "node:crypto";

import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";

import {
  getPool
} from "../db/pool";

import {
  jsonResponse
} from "../common/response";

type AcceptInvitationBody = {
  firstName?: unknown;

  lastName?: unknown;

  password?: unknown;
};

type InvitationRow = {
  id: string;

  company_id: string;

  email: string;
};

const cognitoClient =
  new CognitoIdentityProviderClient(
    {}
  );

function hashToken(
  token: string
): string {
  return createHash(
    "sha256"
  )
    .update(
      token
    )
    .digest(
      "hex"
    );
}

function normalizeName(
  value: unknown
): string | null {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized ||
    null;
}

function getAttribute(
  attributes:
    | {
        Name?: string;
        Value?: string;
      }[]
    | undefined,

  name: string
): string | null {
  return (
    attributes?.find(
      (
        attribute
      ) =>
        attribute.Name ===
        name
    )?.Value ??
    null
  );
}

export async function handler(
  event:
    APIGatewayProxyEvent
): Promise<
  APIGatewayProxyResult
> {
  const token =
    event.pathParameters
      ?.token
      ?.trim();

  if (
    !token ||
    token.length >
      200
  ) {
    return jsonResponse(
      400,
      {
        message:
          "Invitation token is invalid."
      }
    );
  }

  const userPoolId =
    process.env
      .COGNITO_USER_POOL_ID;

  if (
    !userPoolId
  ) {
    return jsonResponse(
      500,
      {
        message:
          "IPCM account creation is not configured."
      }
    );
  }

  let body:
    AcceptInvitationBody;

  try {
    body =
      JSON.parse(
        event.body ??
          "{}"
      ) as
        AcceptInvitationBody;
  } catch {
    return jsonResponse(
      400,
      {
        message:
          "Invalid request body."
      }
    );
  }

  const firstName =
    normalizeName(
      body.firstName
    );

  const lastName =
    normalizeName(
      body.lastName
    );

  const password =
    typeof body.password ===
      "string"
      ? body.password
      : "";

  if (
    !firstName ||
    !lastName ||
    password.length <
      8
  ) {
    return jsonResponse(
      400,
      {
        message:
          "First name, last name, and a valid password are required."
      }
    );
  }

  const pool =
    getPool();

  const client =
    await pool.connect();

  let cognitoUsername:
    | string
    | null =
      null;

  try {
    await client.query(
      "BEGIN"
    );

    const invitationResult =
      await client.query<
        InvitationRow
      >(
        `
        SELECT
          id,
          company_id,
          email

        FROM ipcm_invitations

        WHERE
          token_hash = $1

          AND
          accepted_at
            IS NULL

          AND
          revoked_at
            IS NULL

          AND
          expires_at >
            CURRENT_TIMESTAMP

        FOR UPDATE;
        `,
        [
          hashToken(
            token
          )
        ]
      );

    const invitation =
      invitationResult
        .rows[0];

    if (
      !invitation
    ) {
      await client.query(
        "ROLLBACK"
      );

      return jsonResponse(
        404,
        {
          message:
            "This invitation is invalid, expired, or has already been used."
        }
      );
    }

    const existingUser =
      await client.query(
        `
        SELECT id

        FROM users

        WHERE
          LOWER(email) =
            LOWER($1)

        LIMIT 1;
        `,
        [
          invitation.email
        ]
      );

    if (
      existingUser.rowCount &&
      existingUser.rowCount >
        0
    ) {
      await client.query(
        "ROLLBACK"
      );

      return jsonResponse(
        409,
        {
          message:
            "An Aurem user already exists with this email address."
        }
      );
    }

    const createResponse =
      await cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId:
            userPoolId,

          Username:
            invitation.email,

          MessageAction:
            "SUPPRESS",

          UserAttributes: [
            {
              Name:
                "email",

              Value:
                invitation.email
            },

            {
              Name:
                "email_verified",

              Value:
                "true"
            },

            {
              Name:
                "name",

              Value:
                `${firstName} ${lastName}`
            }
          ]
        })
      );

    cognitoUsername =
      createResponse
        .User
        ?.Username ??
      invitation.email;

    const cognitoSub =
      getAttribute(
        createResponse
          .User
          ?.Attributes,

        "sub"
      );

    if (
      !cognitoSub
    ) {
      throw new Error(
        "Cognito did not return a user sub."
      );
    }

    await cognitoClient.send(
      new AdminSetUserPasswordCommand({
        UserPoolId:
          userPoolId,

        Username:
          cognitoUsername,

        Password:
          password,

        Permanent:
          true
      })
    );

    const roleResult =
      await client.query<{
        id: string;
      }>(
        `
        SELECT id

        FROM roles

        WHERE
          name = 'ipcm'

        LIMIT 1;
        `
      );

    const role =
      roleResult
        .rows[0];

    if (
      !role
    ) {
      throw new Error(
        "IPCM role is not configured."
      );
    }

    const insertResult =
      await client.query<{
        id: string;
      }>(
        `
        INSERT INTO users (
          cognito_user_id,
          email,
          first_name,
          last_name,
          status,
          company_id
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'active',
          $5
        )

        RETURNING id;
        `,
        [
          cognitoSub,

          invitation.email,

          firstName,

          lastName,

          invitation.company_id
        ]
      );

    const userId =
      insertResult
        .rows[0]
        .id;

    await client.query(
      `
      INSERT INTO user_roles (
        user_id,
        role_id
      )
      VALUES (
        $1,
        $2
      );
      `,
      [
        userId,
        role.id
      ]
    );

    await client.query(
      `
      UPDATE ipcm_invitations

      SET
        accepted_at =
          CURRENT_TIMESTAMP,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE
        id = $1;
      `,
      [
        invitation.id
      ]
    );

    await client.query(
      "COMMIT"
    );

    return jsonResponse(
      201,
      {
        message:
          "Your Aurem IPCM account has been created."
      }
    );
  } catch (
    error
  ) {
    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {
      // Ignore rollback failure.
    }

    if (
      cognitoUsername &&
      userPoolId
    ) {
      try {
        await cognitoClient.send(
          new AdminDeleteUserCommand({
            UserPoolId:
              userPoolId,

            Username:
              cognitoUsername
          })
        );
      } catch (
        cleanupError
      ) {
        console.error(
          "Unable to clean up Cognito user",
          cleanupError
        );
      }
    }

    console.error(
      "IPCM account creation failed",
      error
    );

    const errorName =
      error instanceof Error
        ? error.name
        : "";

    if (
      errorName ===
      "UsernameExistsException"
    ) {
      return jsonResponse(
        409,
        {
          message:
            "A Cognito account already exists with this email address."
        }
      );
    }

    if (
      errorName ===
      "InvalidPasswordException"
    ) {
      return jsonResponse(
        400,
        {
          message:
            "The password does not meet the Cognito password policy."
        }
      );
    }

    return jsonResponse(
      500,
      {
        message:
          "Unable to create the IPCM account."
      }
    );
  } finally {
    client.release();
  }
}