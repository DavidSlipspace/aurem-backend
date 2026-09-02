import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  getPool
} from "../db/pool";

import {
  getCurrentUser
} from "../common/currentUser";

import {
  jsonResponse
} from "../common/response";

type UpdateMyProfileBody = {
  firstName?: unknown;

  lastName?: unknown;
};

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

export async function handler(
  event:
    APIGatewayProxyEvent
): Promise<
  APIGatewayProxyResult
> {
  try {
    const currentUser =
      await getCurrentUser(
        event
      );

    if (
      !currentUser
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Authenticated user does not exist in the Aurem database."
        }
      );
    }

    if (
      currentUser.roleName !==
      "ipcm"
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Only IPCM users can update this profile."
        }
      );
    }

    const body =
      JSON.parse(
        event.body ??
          "{}"
      ) as
        UpdateMyProfileBody;

    const firstName =
      normalizeName(
        body.firstName
      );

    const lastName =
      normalizeName(
        body.lastName
      );

    if (
      !firstName ||
      !lastName
    ) {
      return jsonResponse(
        400,
        {
          message:
            "First name and last name are required."
        }
      );
    }

    await getPool().query(
      `
      UPDATE users

      SET
        first_name = $1,

        last_name = $2,

        updated_at =
          CURRENT_TIMESTAMP

      WHERE
        id = $3;
      `,
      [
        firstName,

        lastName,

        currentUser.id
      ]
    );

    const result =
      await getPool()
        .query(
          `
          SELECT
            u.first_name,
            u.last_name,
            u.email,

            r.display_name
              AS role_display_name

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
            r.name = 'ipcm'

          LIMIT 1;
          `,
          [
            currentUser.id
          ]
        );

    const user =
      result.rows[0];

    return jsonResponse(
      200,
      {
        email:
          user.email,

        firstName:
          user.first_name,

        lastName:
          user.last_name,

        role:
          user.role_display_name,

        welcomeMessage:
          `Welcome ${user.role_display_name}, ${user.first_name}`
      }
    );
  } catch (
    error
  ) {
    console.error(
      "PUT /me/profile failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to update profile."
      }
    );
  }
}