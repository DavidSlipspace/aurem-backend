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

  traveler_first_name: string;
  traveler_last_name: string;

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

type ProviderErrorPayload = {
  errorType?: unknown;
  errorMessage?: unknown;
};

type TravelErrorCode =
  | "BOOKING_LINK_REQUIRED"
  | "BOOKING_LINK_INVALID"
  | "BOOKING_LINK_EXPIRED"
  | "FLIGHT_PROVIDER_NOT_CONFIGURED"
  | "DESTINATION_MISSING"
  | "INVALID_AIRPORT"
  | "INVALID_TRIP_DATES"
  | "PAST_TRAVEL_DATE"
  | "INVALID_TRIP_BUDGET"
  | "DESTINATION_NOT_FOUND"
  | "NO_FLIGHTS_FOUND"
  | "PROVIDER_VALIDATION_ERROR"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";

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

function errorResponse(
  statusCode: number,
  code: TravelErrorCode,
  title: string,
  message: string,
  canRetry = false
): APIGatewayProxyResult {
  return jsonResponse(
    statusCode,
    {
      code,
      title,
      message,
      canRetry
    }
  );
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

function formatDateForMessage(
  value: string
): string {
  const date =
    new Date(
      `${value}T12:00:00Z`
    );

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }
  ).format(date);
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

function parseProviderError(
  payload: string
): {
  errorType: string | null;
  errorMessage: string | null;
} {
  if (!payload.trim()) {
    return {
      errorType: null,
      errorMessage: null
    };
  }

  try {
    const parsed =
      JSON.parse(
        payload
      ) as ProviderErrorPayload;

    return {
      errorType:
        typeof parsed.errorType ===
        "string"
          ? parsed.errorType
          : null,

      errorMessage:
        typeof parsed.errorMessage ===
        "string"
          ? parsed.errorMessage
          : null
    };
  } catch {
    return {
      errorType: null,
      errorMessage: payload
    };
  }
}

function providerErrorResponse(
  providerErrorType: string | null,
  providerMessage: string | null
): APIGatewayProxyResult {
  const message =
    providerMessage?.trim() ??
    "";

  const normalized =
    message.toLowerCase();

  if (
    normalized.includes(
      "departure_date"
    ) &&
    normalized.includes(
      "must be after"
    )
  ) {
    return errorResponse(
      400,
      "PAST_TRAVEL_DATE",
      "These travel dates have already passed",
      "Flights can only be searched for future travel. Please contact your case manager to update the trip dates.",
      false
    );
  }

  if (
    normalized.includes(
      "could not resolve"
    ) &&
    normalized.includes(
      "flight destination"
    )
  ) {
    return errorResponse(
      400,
      "DESTINATION_NOT_FOUND",
      "We couldn't identify the destination",
      message,
      false
    );
  }

  if (
    normalized.includes(
      "no offers"
    ) ||
    normalized.includes(
      "no flight"
    )
  ) {
    return errorResponse(
      404,
      "NO_FLIGHTS_FOUND",
      "No flights were found",
      "No available flight options matched this route and these travel dates. Please contact your case manager if the dates or airports need to be changed.",
      false
    );
  }

  if (
    normalized.includes(
      "origin"
    ) ||
    normalized.includes(
      "destination"
    ) ||
    normalized.includes(
      "iata"
    )
  ) {
    return errorResponse(
      400,
      "PROVIDER_VALIDATION_ERROR",
      "We couldn't search this route",
      message ||
        "One of the airports or destinations on this trip could not be used for flight search. Please contact your case manager.",
      false
    );
  }

  if (
    normalized.includes(
      "timeout"
    ) ||
    normalized.includes(
      "timed out"
    ) ||
    normalized.includes(
      "temporarily"
    ) ||
    normalized.includes(
      "unavailable"
    )
  ) {
    return errorResponse(
      503,
      "PROVIDER_UNAVAILABLE",
      "Flight search is temporarily unavailable",
      "The airline search service did not respond in time. Please try again.",
      true
    );
  }

  if (
    providerErrorType ===
    "DuffelApiError" &&
    message
  ) {
    return errorResponse(
      400,
      "PROVIDER_VALIDATION_ERROR",
      "We couldn't complete the flight search",
      message,
      false
    );
  }

  return errorResponse(
    502,
    "PROVIDER_UNAVAILABLE",
    "Flight search is temporarily unavailable",
    "We couldn't retrieve flight options right now. Please try again.",
    true
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
      return errorResponse(
        400,
        "BOOKING_LINK_REQUIRED",
        "Booking link required",
        "A valid booking link is required to search for flights.",
        false
      );
    }

    if (
      token.length > 200
    ) {
      return errorResponse(
        400,
        "BOOKING_LINK_INVALID",
        "Booking link invalid",
        "This booking link is not valid. Please use the most recent link sent by your case manager.",
        false
      );
    }

    const providerFunctionName =
      process.env
        .FLIGHT_PROVIDER_FUNCTION_NAME;

    if (
      !providerFunctionName
    ) {
      return errorResponse(
        500,
        "FLIGHT_PROVIDER_NOT_CONFIGURED",
        "Flight search is unavailable",
        "The flight search service has not been configured correctly.",
        false
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
                AS traveler_first_name,

              gp.legal_last_name
                AS traveler_last_name,

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

            JOIN traveler_profiles gp
              ON gp.id =
                bl.traveler_profile_id

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
      return errorResponse(
        404,
        "BOOKING_LINK_EXPIRED",
        "This booking link is no longer available",
        "The link may have expired or been replaced. Please contact your case manager for a new booking link.",
        false
      );
    }

    const destinationQuery =
      trip
        .destination_city
        ?.trim();

    if (
      !destinationQuery
    ) {
      return errorResponse(
        400,
        "DESTINATION_MISSING",
        "Destination information is missing",
        "This trip does not have a destination city configured. Please contact your case manager to update the trip.",
        false
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
      return errorResponse(
        400,
        "INVALID_AIRPORT",
        "The trip contains an invalid airport",
        "Flight searches require valid three-letter airport codes. Please contact your case manager to update the trip airports.",
        false
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
      return errorResponse(
        400,
        "INVALID_TRIP_DATES",
        "The trip dates need to be corrected",
        `The return date (${formatDateForMessage(
          returnDate
        )}) must be after the outbound date (${formatDateForMessage(
          outboundDate
        )}). Please contact your case manager to update the trip.`,
        false
      );
    }

    const today =
      getTodayDateString();

    if (
      outboundDate <= today
    ) {
      return errorResponse(
        400,
        "PAST_TRAVEL_DATE",
        "These travel dates have already passed",
        `This trip is scheduled for ${formatDateForMessage(
          outboundDate
        )} through ${formatDateForMessage(
          returnDate
        )}. Flight searches can only be performed for future travel. Please contact your case manager to update the trip dates.`,
        false
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
      return errorResponse(
        400,
        "INVALID_TRIP_BUDGET",
        "The trip budget needs to be corrected",
        "This trip does not have a valid positive travel budget. Please contact your case manager to update the trip.",
        false
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

      const providerError =
        parseProviderError(
          errorPayload
        );

      return providerErrorResponse(
        providerError.errorType,
        providerError.errorMessage
      );
    }

    const providerResult =
      parseProviderResult(
        invokeResponse.Payload
      );

    const travelerName =
      `${trip.traveler_first_name} ` +
      `${trip.traveler_last_name}`;

    const response:
      SearchTripFlightsResult = {
      tripReferenceId:
        trip
          .trip_reference_id,

      travelerName:
        travelerName.trim(),

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
      return errorResponse(
        503,
        "PROVIDER_UNAVAILABLE",
        "Flight search is temporarily unavailable",
        "The flight search service is temporarily unavailable. Please try again shortly.",
        true
      );
    }

    if (
      details.name ===
      "ResourceNotFoundException"
    ) {
      return errorResponse(
        503,
        "PROVIDER_UNAVAILABLE",
        "Flight search is temporarily unavailable",
        "The flight search service is temporarily unavailable. Please try again shortly.",
        true
      );
    }

    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Something went wrong",
      "We couldn't complete the flight search because of an unexpected error. Please try again. If the problem continues, contact your case manager.",
      true
    );
  }
}