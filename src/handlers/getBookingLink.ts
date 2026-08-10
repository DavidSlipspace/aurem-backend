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

type BookingLinkRow = {
  booking_link_id: string;

  trip_id: string;
  trip_reference_id: string;

  gc_first_name: string;
  gc_last_name: string;

  expires_at: string;

  used_at:
    | string
    | null;

  status: string;

  ipcm_approval_required: boolean;
};

function hashToken(
  token: string
): string {
  return createHash(
    "sha256"
  )
    .update(token)
    .digest("hex");
}

function getErrorDetails(
  error: unknown
): {
  name: string;
  message: string;
  stack?: string;
} {
  if (
    error instanceof Error
  ) {
    return {
      name:
        error.name,

      message:
        error.message,

      stack:
        error.stack
    };
  }

  return {
    name:
      "UnknownError",

    message:
      String(error)
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const token =
      event.pathParameters
        ?.token
        ?.trim();

    if (!token) {
      return jsonResponse(
        400,
        {
          message:
            "Booking token is required."
        }
      );
    }

    if (
      token.length > 200
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Booking token is invalid."
        }
      );
    }

    const tokenHash =
      hashToken(token);

    const result =
      await getPool()
        .query<BookingLinkRow>(
          `
            SELECT
              bl.id
                AS booking_link_id,

              t.id
                AS trip_id,

              t.trip_reference_id,

              gp.legal_first_name
                AS gc_first_name,

              gp.legal_last_name
                AS gc_last_name,

              bl.expires_at,
              bl.used_at,

              t.status,

              t.ipcm_approval_required

            FROM booking_links bl

            JOIN trips t
              ON t.id =
                bl.trip_id

            JOIN gc_profiles gp
              ON gp.id =
                bl.gc_profile_id

            WHERE
              bl.token_hash = $1

              AND
                bl.revoked_at
                IS NULL

              AND
                bl.expires_at >
                CURRENT_TIMESTAMP

            LIMIT 1;
          `,
          [
            tokenHash
          ]
        );

    const bookingLink =
      result.rows[0];

    if (!bookingLink) {
      return jsonResponse(
        404,
        {
          message:
            "This booking link is invalid, expired, or has been replaced."
        }
      );
    }

    const gcName =
      `${bookingLink.gc_first_name} ` +
      `${bookingLink.gc_last_name}`;

    return jsonResponse(
      200,
      {
        bookingLinkId:
          bookingLink
            .booking_link_id,

        tripId:
          bookingLink
            .trip_id,

        tripReferenceId:
          bookingLink
            .trip_reference_id,

        gcName:
          gcName.trim(),

        expiresAt:
          bookingLink
            .expires_at,

        submitted:
          bookingLink
            .used_at !== null,

        submittedAt:
          bookingLink
            .used_at,

        status:
          bookingLink
            .status,

        ipcmApprovalRequired:
          bookingLink
            .ipcm_approval_required
      }
    );
  } catch (error) {
    console.error(
      "GET /public/booking-links/{token} failed",
      getErrorDetails(
        error
      )
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to load the booking link."
      }
    );
  }
}