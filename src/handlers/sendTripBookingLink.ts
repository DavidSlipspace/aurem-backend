import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

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
  gc_first_name: string;
  gc_last_name: string;
  gc_email: string | null;
};

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
  const parsedPayload = JSON.parse(decodedPayload) as Partial<SendEmailResult>;

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

    const emailServiceFunctionName =
      process.env.EMAIL_SERVICE_FUNCTION_NAME;

    if (!emailServiceFunctionName) {
      console.error(
        "EMAIL_SERVICE_FUNCTION_NAME environment variable is missing."
      );

      return jsonResponse(500, {
        message:
          "The email service has not been configured."
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
      accessClause = "c.case_manager_user_id = $2";
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

    const safeGcName = escapeHtml(gcName);

    console.log("7. Trip and GC email validated", {
      tripId: trip.id,
      tripReferenceId: trip.trip_reference_id,
      gcName,
      destinationEmail: trip.gc_email
    });

    const emailRequest: SendEmailRequest = {
      to: trip.gc_email,
      subject: "Hello from Aurem",
      textBody: `Hello ${gcName}`,
      htmlBody: `
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
            <p>Hello ${safeGcName}</p>
          </body>
        </html>
      `.trim()
    };

    console.log("8. Invoking email service", {
      emailServiceFunctionName,
      destinationEmail: trip.gc_email
    });

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

      console.error("Email service returned an error", {
        functionError: invokeResponse.FunctionError,
        errorPayload
      });

      throw new Error(
        `Email service failed: ${errorPayload}`
      );
    }

    const emailResult = parseEmailServiceResult(
      invokeResponse.Payload
    );

    console.log("9. Email service completed", {
      messageId: emailResult.messageId
    });

    return jsonResponse(200, {
      message: "Test email sent successfully.",
      tripId: trip.id,
      tripReferenceId: trip.trip_reference_id,
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
      message: "Unable to send the test email.",
      error: errorDetails.name
    });
  }
}