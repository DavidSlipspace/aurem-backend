import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  createHash
} from "node:crypto";

import {
  getPool
} from "../db/pool";

import {
  jsonResponse
} from "../common/response";

type InvitationRow = {
  email: string;

  expires_at: string;
};

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

export async function handler(
  event:
    APIGatewayProxyEvent
): Promise<
  APIGatewayProxyResult
> {
  try {
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

    const result =
      await getPool()
        .query<
          InvitationRow
        >(
          `
          SELECT
            ii.email,
            ii.expires_at

          FROM ipcm_invitations ii

          WHERE
            ii.token_hash = $1

            AND
            ii.accepted_at
              IS NULL

            AND
            ii.revoked_at
              IS NULL

            AND
            ii.expires_at >
              CURRENT_TIMESTAMP

          LIMIT 1;
          `,
          [
            hashToken(
              token
            )
          ]
        );

    const invitation =
      result.rows[0];

    if (
      !invitation
    ) {
      return jsonResponse(
        404,
        {
          message:
            "This invitation is invalid, expired, or has already been used."
        }
      );
    }

    return jsonResponse(
      200,
      {
        email:
          invitation.email,

        expiresAt:
          invitation.expires_at
      }
    );
  } catch (
    error
  ) {
    console.error(
      "GET IPCM invitation failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to validate the IPCM invitation."
      }
    );
  }
}