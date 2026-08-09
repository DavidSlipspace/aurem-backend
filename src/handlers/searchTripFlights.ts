import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

import {
  createHash
} from "node:crypto";

import {
  getPool
} from "../db/pool";

import {
  jsonResponse
} from "../common/response";

import type {
  FlightProviderRequest,
  FlightProviderResult,
  SearchTripFlightsResult
} from "../types/flight";

type TripFlightSearchRow = {
  trip_reference_id: string;

  gc_first_name: string;
  gc_last_name: string;

  outbound_date:
    | Date
    | string;

  return_date:
    | Date
    | string;

  outbound_airport: string;

  return_airport: string;

  destination_city:
    | string
    | null;

  budget_filter: number;

  companion_traveler: boolean;
};

const lambdaClient =
  new LambdaClient({});

const textEncoder =
  new TextEncoder();

const textDecoder =
  new TextDecoder();

const DEFAULT_CURRENCY =
  "USD";

const MAXIMUM_FLIGHT_RESULTS =
  10;

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

function normalizeDateValue(
  value:
    | Date
    | string
): string {
  if (
    value instanceof Date
  ) {
    if (
      Number.isNaN(
        value.getTime()
      )
    ) {
      throw new Error(
        "The trip contains an invalid date."
      );
    }

    return value
      .toISOString()
      .substring(0, 10);
  }

  if (
    typeof value === "string"
  ) {
    const normalized =
      value.trim();

    const directDateMatch =
      normalized.match(
        /^\d{4}-\d{2}-\d{2}/
      );

    if (
      directDateMatch
    ) {
      return directDateMatch[0];
    }

    const parsed =
      new Date(normalized);

    if (
      Number.isNaN(
        parsed.getTime()
      )
    ) {
      throw new Error(
        "The trip contains an invalid date."
      );
    }

    return parsed
      .toISOString()
      .substring(0, 10);
  }

  throw new Error(
    "The trip date is in an unsupported format."
  );
}

function normalizeAirportCode(
  value: string
): string | null {
  const normalized =
    value
      .trim()
      .toUpperCase();

  return /^[A-Z]{3}$/.test(
    normalized
  )
    ? normalized
    : null;
}

function getTodayDateString(): string {
  return new Date()
    .toISOString()
    .substring(0, 10);
}

function parseProviderResult(
  payload:
    | Uint8Array
    | undefined
): FlightProviderResult {
  if (!payload) {
    throw new Error(
      "The flight provider returned an empty response."
    );
  }

  const decoded =
    textDecoder.decode(
      payload
    );

  const parsed =
    JSON.parse(
      decoded
    ) as Partial<FlightProviderResult>;

  if (
    !Array.isArray(
      parsed.flights
    ) ||

    typeof parsed.destinationCode !==
      "string" ||

    typeof parsed.flightBudgetCents !==
      "number"
  ) {
    throw new Error(
      "The flight provider returned an invalid response."
    );
  }

  return (
    parsed as
      FlightProviderResult
  );
}

function extractProviderMessage(
  payload: string
): string | null {
  try {
    const parsed =
      JSON.parse(
        payload
      ) as {
        errorMessage?: unknown;
      };

    if (
      typeof parsed.errorMessage ===
        "string" &&
      parsed.errorMessage.trim()
    ) {
      return parsed.errorMessage.trim();
    }
  } catch {
    // Ignore malformed provider errors
    // and fall back to the generic message.
  }

  return null;
}

function getFriendlyProviderMessage(
  providerMessage: string
): string {
  const normalized =
    providerMessage
      .toLowerCase();

  if (
    normalized.includes(
      "departure_date"
    ) &&
    normalized.includes(
      "must be after"
    )
  ) {
    return (
      "This trip's travel dates have already passed. " +
      "Please contact your case manager to update the trip dates."
    );
  }

  if (
    normalized.includes(
      "no offers"
    )
  ) {
    return (
      "No flights are currently available for this route and date combination. " +
      "Please contact your case manager if the trip dates or airports need to be adjusted."
    );
  }

  if (
    normalized.includes(
      "origin"
    ) ||
    normalized.includes(
      "destination"
    )
  ) {
    return (
      "We could not search the configured flight route. " +
      "Please contact your case manager to confirm the trip airports and destination."
    );
  }

  return (
    "We were unable to retrieve flight options for this trip. " +
    "Please try again or contact your case manager if the problem continues."
  );
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

    const providerFunctionName =
      process.env
        .FLIGHT_PROVIDER_FUNCTION_NAME;

    if (
      !providerFunctionName
    ) {
      return jsonResponse(
        500,
        {
          message:
            "The flight provider has not been configured."
        }
      );
    }

    const tokenHash =
      hashToken(token);

    const result =
      await getPool()
        .query<TripFlightSearchRow>(
          `
            SELECT
              t.trip_reference_id,

              gp.legal_first_name
                AS gc_first_name,

              gp.legal_last_name
                AS gc_last_name,

              t.outbound_date,
              t.return_date,

              t.outbound_airport,
              t.return_airport,

              t.destination_city,

              t.budget_filter,

              t.companion_traveler

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
          [tokenHash]
        );

    const trip =
      result.rows[0];

    if (!trip) {
      return jsonResponse(
        404,
        {
          message:
            "This booking link is invalid, expired, or has been replaced."
        }
      );
    }

    const destinationQuery =
      trip
        .destination_city
        ?.trim();

    if (
      !destinationQuery
    ) {
      return jsonResponse(
        400,
        {
          message:
            "The trip needs a destination city before flights can be searched."
        }
      );
    }

    const originAirportCode =
      normalizeAirportCode(
        trip
          .outbound_airport
      );

    const returnAirportCode =
      normalizeAirportCode(
        trip
          .return_airport
      );

    if (
      !originAirportCode ||
      !returnAirportCode
    ) {
      return jsonResponse(
        400,
        {
          message:
            "The trip must contain valid three-letter outbound and return airport codes."
        }
      );
    }

    const outboundDate =
      normalizeDateValue(
        trip.outbound_date
      );

    const returnDate =
      normalizeDateValue(
        trip.return_date
      );

    if (
      returnDate <=
      outboundDate
    ) {
      return jsonResponse(
        400,
        {
          message:
            "The trip return date must be after the outbound date."
        }
      );
    }

    const today =
      getTodayDateString();

    if (
      outboundDate <= today
    ) {
      return jsonResponse(
        400,
        {
          message:
            "This trip's travel dates have already passed. Please contact your case manager to update the trip dates."
        }
      );
    }

    const totalTripBudgetCents =
      Number(
        trip.budget_filter
      );

    if (
      !Number.isInteger(
        totalTripBudgetCents
      ) ||
      totalTripBudgetCents <= 0
    ) {
      return jsonResponse(
        400,
        {
          message:
            "The trip does not have a valid travel budget."
        }
      );
    }

    const flightBudgetCents =
      Math.max(
        1,

        Math.floor(
          (
            totalTripBudgetCents *
            2
          ) /
            3
        )
      );

    const providerRequest:
      FlightProviderRequest = {
      originAirportCode,

      returnAirportCode,

      destinationQuery,

      outboundDate,

      returnDate,

      adultPassengers:
        trip.companion_traveler
          ? 2
          : 1,

      flightBudgetCents,

      currency:
        DEFAULT_CURRENCY,

      maximumResults:
        MAXIMUM_FLIGHT_RESULTS
    };

    console.log(
      "Invoking flight provider",
      {
        providerFunctionName,

        tripReferenceId:
          trip
            .trip_reference_id,

        originAirportCode,

        returnAirportCode,

        destinationQuery,

        outboundDate,

        returnDate,

        adultPassengers:
          providerRequest
            .adultPassengers,

        flightBudgetCents
      }
    );

    const invokeResponse =
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName:
            providerFunctionName,

          InvocationType:
            "RequestResponse",

          Payload:
            textEncoder.encode(
              JSON.stringify(
                providerRequest
              )
            )
        })
      );

    if (
      invokeResponse
        .FunctionError
    ) {
      const errorPayload =
        invokeResponse.Payload
          ? textDecoder.decode(
              invokeResponse.Payload
            )
          : "";

      console.error(
        "Flight provider returned an error",
        {
          functionError:
            invokeResponse
              .FunctionError,

          errorPayload
        }
      );

      const providerMessage =
        extractProviderMessage(
          errorPayload
        );

      return jsonResponse(
        400,
        {
          message:
            providerMessage
              ? getFriendlyProviderMessage(
                  providerMessage
                )
              : "We were unable to retrieve flight options for this trip. Please try again or contact your case manager."
        }
      );
    }

    const providerResult =
      parseProviderResult(
        invokeResponse.Payload
      );

    const gcName =
      `${trip.gc_first_name} ` +
      `${trip.gc_last_name}`;

    const response:
      SearchTripFlightsResult = {
      tripReferenceId:
        trip
          .trip_reference_id,

      gcName:
        gcName.trim(),

      originAirportCode:
        providerResult
          .originAirportCode,

      returnAirportCode:
        providerResult
          .returnAirportCode,

      destinationName:
        providerResult
          .destinationName,

      destinationCode:
        providerResult
          .destinationCode,

      outboundDate:
        providerResult
          .outboundDate,

      returnDate:
        providerResult
          .returnDate,

      adultPassengers:
        providerResult
          .adultPassengers,

      totalTripBudgetCents,

      flightBudgetCents,

      currency:
        providerResult
          .currency,

      flights:
        providerResult
          .flights
    };

    return jsonResponse(
      200,
      response
    );
  } catch (error) {
    const details =
      getErrorDetails(error);

    console.error(
      "POST /public/booking-links/{token}/flights/search failed",
      details
    );

    if (
      details.name ===
      "AccessDeniedException"
    ) {
      return jsonResponse(
        500,
        {
          message:
            "The flight search service is temporarily unavailable. Please try again shortly.",

          error:
            details.name
        }
      );
    }

    if (
      details.name ===
      "ResourceNotFoundException"
    ) {
      return jsonResponse(
        500,
        {
          message:
            "The flight search service is temporarily unavailable. Please try again shortly.",

          error:
            details.name
        }
      );
    }

    return jsonResponse(
      500,
      {
        message:
          "We were unable to search for flights. Please try again or contact your case manager if the problem continues.",

        error:
          details.name
      }
    );
  }
}