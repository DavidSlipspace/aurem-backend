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
  trip_reference_id: string;
  gc_first_name: string;
  gc_last_name: string;
  gc_email: string | null;
};

const sesClient = new SESv2Client({});

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getErrorDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  console.log("1. Send-trip-booking-link handler started", {
    requestId: event.requestContext.requestId,
    httpMethod: event.httpMethod,
    path: event.path,
    pathParameters: event.pathParameters
  });

  try {
    console.log("2. Loading current user");

    const currentUser = await getCurrentUser(event);

    console.log("3. Current user lookup completed", {
      userFound: Boolean(currentUser),
      userId: currentUser?.id,
      roleName: currentUser?.roleName,
      companyId: currentUser?.companyId
    });

    if (!currentUser) {
      return jsonResponse(403, {
        message:
          "Authenticated user does not exist in the Aurem database."
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
        "SES_SOURCE_EMAIL environment variable is missing."
      );

      return jsonResponse(500, {
        message:
          "The SES sender email has not been configured."
      });
    }

    console.log("4. Preparing database query", {
      tripId,
      roleName: currentUser.roleName
    });

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

    console.log("5. Starting trip database query");

    const result = await pool.query<TripEmailRow>(
      `
        SELECT
          t.id,
          t.trip_reference_id,
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

    console.log("6. Trip database query completed", {
      rowCount: result.rowCount
    });

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

    console.log("7. Trip and GC email validated", {
      tripId: trip.id,
      tripReferenceId: trip.trip_reference_id,
      gcName,
      destinationEmail: trip.gc_email
    });

    console.log("8. Starting SES SendEmail request", {
      sourceEmail,
      destinationEmail: trip.gc_email
    });

    /*
     * Abort the SES request before the Lambda's overall timeout.
     *
     * Your Lambda currently has a 15-second timeout. This aborts the SES
     * request after eight seconds so the catch block can return a useful
     * response instead of API Gateway receiving an unexplained 502.
     */
    const abortController = new AbortController();

    const abortTimer = setTimeout(() => {
      console.error(
        "SES request exceeded eight seconds. Aborting request."
      );

      abortController.abort();
    }, 8000);

    try {
      const sesResponse = await sesClient.send(
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
                  Data: `
                    <!DOCTYPE html>
                    <html lang="en">
                      <head>
                        <meta charset="UTF-8" />
                        <meta
                          name="viewport"
                          content="width=device-width, initial-scale=1.0"
                        />
                        <title>Hello from Aurem</title>
                      </head>
                      <body>
                        <p>Hello ${gcName}</p>
                      </body>
                    </html>
                  `.trim(),
                  Charset: "UTF-8"
                }
              }
            }
          }
        }),
        {
          abortSignal: abortController.signal
        }
      );

      console.log("9. SES SendEmail request completed", {
        messageId: sesResponse.MessageId
      });

      return jsonResponse(200, {
        message: "Test email sent successfully.",
        tripId: trip.id,
        tripReferenceId: trip.trip_reference_id,
        sentTo: trip.gc_email,
        gcName,
        messageId: sesResponse.MessageId,
        sesSkipped: false
      });
    } finally {
      clearTimeout(abortTimer);
    }
  } catch (error) {
    const errorDetails =
      getErrorDetails(error);

    console.error(
      "POST /trips/{id}/booking-link failed",
      errorDetails
    );

    if (
      errorDetails.name === "AbortError" ||
      errorDetails.name ===
        "RequestAbortedError"
    ) {
      return jsonResponse(504, {
        message:
          "The trip and GC were loaded, but the Lambda could not connect to Amazon SES before the request timed out.",
        error: errorDetails.name
      });
    }

    if (
      errorDetails.name === "MessageRejected"
    ) {
      return jsonResponse(502, {
        message:
          "Amazon SES rejected the email. Confirm that the sender and recipient identities are verified in the Lambda's AWS region.",
        error: errorDetails.name
      });
    }

    if (
      errorDetails.name ===
        "AccessDeniedException"
    ) {
      return jsonResponse(500, {
        message:
          "The Lambda does not have permission to send email through Amazon SES.",
        error: errorDetails.name
      });
    }

    return jsonResponse(500, {
      message: "Unable to send the test email.",
      error: errorDetails.name
    });
  }
}