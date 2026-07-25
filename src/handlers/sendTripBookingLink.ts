import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  SESv2Client,
  SendEmailCommand
} from "@aws-sdk/client-sesv2";

import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";
import { getCurrentUser } from "../common/currentUser";

type TripEmailRow = {
  id: string;
  gc_first_name: string;
  gc_last_name: string;
  gc_email: string | null;
};

const sesClient = new SESv2Client({});

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const currentUser = await getCurrentUser(event);

    if (!currentUser) {
      return jsonResponse(403, {
        message:
          "Authenticated user does not exist in Aurem database."
      });
    }

    if (
      currentUser.roleName !== "admin" &&
      currentUser.roleName !== "case_manager"
    ) {
      return jsonResponse(403, {
        message:
          "User role is not authorized to send trip emails."
      });
    }

    const tripId =
      event.pathParameters?.id ??
      event.pathParameters?.tripId;

    if (!tripId) {
      return jsonResponse(400, {
        message: "Trip ID is required."
      });
    }

    const sourceEmail =
      process.env.SES_SOURCE_EMAIL;

    if (!sourceEmail) {
      console.error(
        "SES_SOURCE_EMAIL is not configured."
      );

      return jsonResponse(500, {
        message:
          "The email sender has not been configured."
      });
    }

    const pool = getPool();

    let accessClause: string;
    const params: string[] = [tripId];

    if (currentUser.roleName === "admin") {
      accessClause = "cm.company_id = $2";
      params.push(currentUser.companyId);
    } else {
      accessClause =
        "c.case_manager_user_id = $2";
      params.push(currentUser.id);
    }

    const result = await pool.query<TripEmailRow>(
      `
        SELECT
          t.id,
          gp.legal_first_name AS gc_first_name,
          gp.legal_last_name AS gc_last_name,
          gp.email AS gc_email
        FROM trips t
        JOIN cases c
          ON c.id = t.case_id
        JOIN users cm
          ON cm.id = c.case_manager_user_id
        JOIN gc_profiles gp
          ON gp.id = t.gc_profile_id
        WHERE
          t.id = $1
          AND ${accessClause}
        LIMIT 1;
      `,
      params
    );

    const trip = result.rows[0];

    if (!trip) {
      return jsonResponse(404, {
        message:
          "Trip was not found or you do not have access to it."
      });
    }

    if (
      !trip.gc_email ||
      !isValidEmail(trip.gc_email)
    ) {
      return jsonResponse(400, {
        message:
          "The GC profile does not have a valid email address."
      });
    }

    const gcName =
      `${trip.gc_first_name} ${trip.gc_last_name}`.trim();

    await sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: sourceEmail,
        Destination: {
          ToAddresses: [trip.gc_email]
        },
        Content: {
          Simple: {
            Subject: {
              Data: "Hello from Aurem",
              Charset: "UTF-8"
            },
            Body: {
              Text: {
                Data: `Hello ${gcName}`,
                Charset: "UTF-8"
              },
              Html: {
                Data: `<p>Hello ${gcName}</p>`,
                Charset: "UTF-8"
              }
            }
          }
        }
      })
    );

    return jsonResponse(200, {
      message: "Test email sent successfully.",
      tripId: trip.id,
      sentTo: trip.gc_email
    });
  } catch (error) {
    console.error(
      "POST /trips/{id}/booking-link error",
      error
    );

    return jsonResponse(500, {
      message: "Unable to send the test email."
    });
  }
}