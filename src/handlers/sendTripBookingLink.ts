import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

import {
  createHash,
  randomBytes,
  randomUUID
} from "node:crypto";

import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";
import { getCurrentUser } from "../common/currentUser";

import type {
  SendEmailRequest,
  SendEmailResult
} from "./sendEmail";

type TripEmailRow = {
  id: string;
  trip_reference_id: string;
  gc_profile_id: string;
  gc_first_name: string;
  gc_last_name: string;
  gc_email: string | null;
};

const BOOKING_LINK_EXPIRATION_DAYS = 7;

const lambdaClient = new LambdaClient({});
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeFrontendBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function createBookingToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = randomBytes(32).toString("base64url");

  const tokenHash = createHash("sha256")
    .update(rawToken)
    .digest("hex");

  return {
    rawToken,
    tokenHash
  };
}

function getExpirationDate(): Date {
  const expiresAt = new Date();

  expiresAt.setUTCDate(
    expiresAt.getUTCDate() + BOOKING_LINK_EXPIRATION_DAYS
  );

  return expiresAt;
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

function parseEmailServiceResult(
  payload: Uint8Array | undefined
): SendEmailResult {
  if (!payload) {
    throw new Error(
      "The email service returned an empty response."
    );
  }

  const decodedPayload = textDecoder.decode(payload);

  const parsedPayload = JSON.parse(
    decodedPayload
  ) as Partial<SendEmailResult>;

  if (
    typeof parsedPayload.messageId !== "string" ||
    parsedPayload.messageId.length === 0
  ) {
    throw new Error(
      "The email service response did not contain a message ID."
    );
  }

  return {
    messageId: parsedPayload.messageId
  };
}

function createTextEmail(
  gcName: string,
  tripReferenceId: string,
  bookingUrl: string
): string {
  return [
    `Hello ${gcName},`,
    "",
    "Your travel request is ready for review.",
    "",
    `Trip reference: ${tripReferenceId}`,
    "",
    "Use the secure link below to review your trip:",
    bookingUrl,
    "",
    `This link expires in ${BOOKING_LINK_EXPIRATION_DAYS} days.`,
    "",
    "If you were not expecting this email, you can safely ignore it.",
    "",
    "Aurem Travel"
  ].join("\n");
}

function createHtmlEmail(
  gcName: string,
  tripReferenceId: string,
  bookingUrl: string
): string {
  const safeGcName = escapeHtml(gcName);
  const safeTripReferenceId = escapeHtml(
    tripReferenceId
  );
  const safeBookingUrl = escapeHtml(bookingUrl);

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
        <title>Your Aurem travel request</title>
      </head>

      <body
        style="
          margin: 0;
          padding: 0;
          background-color: #f4f6f8;
          font-family: Arial, Helvetica, sans-serif;
          color: #17202a;
        "
      >
        <table
          role="presentation"
          width="100%"
          cellspacing="0"
          cellpadding="0"
          border="0"
          style="background-color: #f4f6f8;"
        >
          <tr>
            <td
              align="center"
              style="padding: 40px 16px;"
            >
              <table
                role="presentation"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                border="0"
                style="
                  max-width: 600px;
                  background-color: #ffffff;
                  border: 1px solid #e4e7ec;
                  border-radius: 16px;
                  overflow: hidden;
                "
              >
                <tr>
                  <td
                    style="
                      padding: 28px 32px;
                      background-color: #111827;
                    "
                  >
                    <p
                      style="
                        margin: 0;
                        color: #ffffff;
                        font-size: 24px;
                        font-weight: 700;
                        letter-spacing: -0.02em;
                      "
                    >
                      Aurem Travel
                    </p>

                    <p
                      style="
                        margin: 8px 0 0;
                        color: #d1d5db;
                        font-size: 14px;
                      "
                    >
                      Secure travel coordination
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding: 36px 32px;">
                    <h1
                      style="
                        margin: 0 0 16px;
                        color: #111827;
                        font-size: 28px;
                        line-height: 1.25;
                      "
                    >
                      Hello ${safeGcName},
                    </h1>

                    <p
                      style="
                        margin: 0 0 20px;
                        color: #475467;
                        font-size: 16px;
                        line-height: 1.6;
                      "
                    >
                      Your travel request is ready for
                      review. Use the secure button below
                      to continue.
                    </p>

                    <table
                      role="presentation"
                      width="100%"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                      style="
                        margin: 0 0 28px;
                        background-color: #f8fafc;
                        border: 1px solid #e4e7ec;
                        border-radius: 10px;
                      "
                    >
                      <tr>
                        <td style="padding: 18px 20px;">
                          <p
                            style="
                              margin: 0 0 6px;
                              color: #667085;
                              font-size: 12px;
                              font-weight: 700;
                              letter-spacing: 0.05em;
                              text-transform: uppercase;
                            "
                          >
                            Trip reference
                          </p>

                          <p
                            style="
                              margin: 0;
                              color: #101828;
                              font-size: 16px;
                              font-weight: 700;
                            "
                          >
                            ${safeTripReferenceId}
                          </p>
                        </td>
                      </tr>
                    </table>

                    <table
                      role="presentation"
                      cellspacing="0"
                      cellpadding="0"
                      border="0"
                    >
                      <tr>
                        <td
                          align="center"
                          style="
                            background-color: #111827;
                            border-radius: 8px;
                          "
                        >
                          <a
                            href="${safeBookingUrl}"
                            style="
                              display: inline-block;
                              padding: 14px 24px;
                              color: #ffffff;
                              font-size: 16px;
                              font-weight: 700;
                              text-decoration: none;
                            "
                          >
                            Review Travel Request
                          </a>
                        </td>
                      </tr>
                    </table>

                    <p
                      style="
                        margin: 24px 0 0;
                        color: #667085;
                        font-size: 13px;
                        line-height: 1.6;
                      "
                    >
                      This secure link expires in
                      ${BOOKING_LINK_EXPIRATION_DAYS} days.
                    </p>

                    <p
                      style="
                        margin: 12px 0 0;
                        color: #667085;
                        font-size: 13px;
                        line-height: 1.6;
                      "
                    >
                      If the button does not work, copy and
                      paste this link into your browser:
                    </p>

                    <p
                      style="
                        margin: 8px 0 0;
                        color: #344054;
                        font-size: 12px;
                        line-height: 1.6;
                        overflow-wrap: anywhere;
                      "
                    >
                      ${safeBookingUrl}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td
                    style="
                      padding: 20px 32px;
                      background-color: #f8fafc;
                      border-top: 1px solid #e4e7ec;
                    "
                  >
                    <p
                      style="
                        margin: 0;
                        color: #667085;
                        font-size: 12px;
                        line-height: 1.5;
                      "
                    >
                      This message was sent because a travel
                      request was created for you. If you were
                      not expecting it, you can safely ignore
                      this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `.trim();
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

  let createdBookingLinkId: string | null = null;

  try {
    const currentUser = await getCurrentUser(event);

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

    const emailServiceFunctionName =
      process.env.EMAIL_SERVICE_FUNCTION_NAME;

    if (!emailServiceFunctionName) {
      return jsonResponse(500, {
        message:
          "The email service has not been configured."
      });
    }

    const frontendBaseUrlValue =
      process.env.FRONTEND_BASE_URL;

    if (!frontendBaseUrlValue) {
      return jsonResponse(500, {
        message:
          "The frontend booking URL has not been configured."
      });
    }

    const frontendBaseUrl =
      normalizeFrontendBaseUrl(frontendBaseUrlValue);

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
          t.trip_reference_id,
          t.gc_profile_id,
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

    const {
      rawToken,
      tokenHash
    } = createBookingToken();

    const bookingLinkId = randomUUID();
    const expiresAt = getExpirationDate();

    createdBookingLinkId = bookingLinkId;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `
          UPDATE booking_links
          SET
            revoked_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE
            trip_id = $1
            AND revoked_at IS NULL
            AND used_at IS NULL;
        `,
        [trip.id]
      );

      await client.query(
        `
          INSERT INTO booking_links (
            id,
            trip_id,
            gc_profile_id,
            token_hash,
            expires_at,
            created_at,
            updated_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          );
        `,
        [
          bookingLinkId,
          trip.id,
          trip.gc_profile_id,
          tokenHash,
          expiresAt
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const bookingUrl =
      `${frontendBaseUrl}/booking/${rawToken}`;

    const emailRequest: SendEmailRequest = {
      to: trip.gc_email,
      subject:
        "Your Aurem travel request is ready",
      textBody: createTextEmail(
        gcName,
        trip.trip_reference_id,
        bookingUrl
      ),
      htmlBody: createHtmlEmail(
        gcName,
        trip.trip_reference_id,
        bookingUrl
      )
    };

    const invokeResponse = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: emailServiceFunctionName,
        InvocationType: "RequestResponse",
        Payload: textEncoder.encode(
          JSON.stringify(emailRequest)
        )
      })
    );

    if (invokeResponse.FunctionError) {
      const errorPayload = invokeResponse.Payload
        ? textDecoder.decode(invokeResponse.Payload)
        : "No error payload returned.";

      throw new Error(
        `Email service failed: ${errorPayload}`
      );
    }

    const emailResult = parseEmailServiceResult(
      invokeResponse.Payload
    );

    return jsonResponse(200, {
      message:
        "Secure booking link sent successfully.",
      tripId: trip.id,
      tripReferenceId: trip.trip_reference_id,
      bookingLinkId,
      expiresAt: expiresAt.toISOString(),
      sentTo: trip.gc_email,
      gcName,
      messageId: emailResult.messageId
    });
  } catch (error) {
    const errorDetails = getErrorDetails(error);

    console.error(
      "POST /trips/{id}/booking-link failed",
      errorDetails
    );

    if (createdBookingLinkId) {
      try {
        await getPool().query(
          `
            UPDATE booking_links
            SET
              revoked_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1;
          `,
          [createdBookingLinkId]
        );
      } catch (cleanupError) {
        console.error(
          "Unable to revoke failed booking link",
          getErrorDetails(cleanupError)
        );
      }
    }

    if (
      errorDetails.name === "AccessDeniedException"
    ) {
      return jsonResponse(500, {
        message:
          "The booking-link Lambda does not have permission to invoke the email service.",
        error: errorDetails.name
      });
    }

    if (
      errorDetails.name === "ResourceNotFoundException"
    ) {
      return jsonResponse(500, {
        message:
          "The configured email service Lambda could not be found.",
        error: errorDetails.name
      });
    }

    return jsonResponse(500, {
      message:
        "Unable to create and send the booking link.",
      error: errorDetails.name
    });
  }
}