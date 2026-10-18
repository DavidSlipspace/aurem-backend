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
  HotelProviderRequest,
  HotelProviderResult,
  SearchTripHotelsResult
} from "../types/hotel";

type TripHotelSearchRow = {
  trip_reference_id: string;

  traveler_first_name: string;
  traveler_last_name: string;

  outbound_date:
    | Date
    | string;

  return_date:
    | Date
    | string;

  destination_city:
    | string
    | null;

  destination_address:
    | string
    | null;

  hotel_proximity_preference:
    | string
    | null;

  minimum_hotel_star_rating:
    | number
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
  | "HOTEL_PROVIDER_NOT_CONFIGURED"
  | "DESTINATION_MISSING"
  | "DESTINATION_NOT_FOUND"
  | "INVALID_TRIP_DATES"
  | "PAST_TRAVEL_DATE"
  | "INVALID_TRIP_BUDGET"
  | "INVALID_STAR_RATING"
  | "STAYS_NOT_ENABLED"
  | "NO_HOTELS_FOUND"
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

const MAXIMUM_HOTEL_RESULTS =
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
    const normalizedValue =
      value.trim();

    if (!normalizedValue) {
      throw new Error(
        "The trip contains an empty date."
      );
    }

    const directDateMatch =
      normalizedValue.match(
        /^\d{4}-\d{2}-\d{2}/
      );

    if (
      directDateMatch
    ) {
      return directDateMatch[0];
    }

    const parsedDate =
      new Date(
        normalizedValue
      );

    if (
      Number.isNaN(
        parsedDate.getTime()
      )
    ) {
      throw new Error(
        "The trip contains an invalid date."
      );
    }

    return parsedDate
      .toISOString()
      .substring(0, 10);
  }

  throw new Error(
    "The trip date is in an unsupported format."
  );
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

function buildDestination(
  row: TripHotelSearchRow
): string | null {
  const address =
    row
      .destination_address
      ?.trim();

  const city =
    row
      .destination_city
      ?.trim();

  if (
    address &&
    city
  ) {
    const lowerAddress =
      address
        .toLowerCase();

    const lowerCity =
      city
        .toLowerCase();

    return lowerAddress.includes(
      lowerCity
    )
      ? address
      : `${address}, ${city}`;
  }

  if (address) {
    return address;
  }

  if (city) {
    return city;
  }

  return null;
}

function getRadiusKilometers(
  preference:
    | string
    | null
): number {
  const normalized =
    preference
      ?.trim()
      .toLowerCase() ??
    "";

  if (
    normalized.includes(
      "walking"
    )
  ) {
    return 2;
  }

  if (
    normalized.includes(
      "1 mile"
    ) ||
    normalized.includes(
      "one mile"
    )
  ) {
    return 2;
  }

  if (
    normalized.includes(
      "5 mile"
    ) ||
    normalized.includes(
      "five mile"
    )
  ) {
    return 8;
  }

  if (
    normalized.includes(
      "10 mile"
    ) ||
    normalized.includes(
      "ten mile"
    )
  ) {
    return 16;
  }

  if (
    normalized.includes(
      "no preference"
    )
  ) {
    return 20;
  }

  return 8;
}

function parseHotelProviderResult(
  payload:
    | Uint8Array
    | undefined
): HotelProviderResult {
  if (!payload) {
    throw new Error(
      "The hotel provider returned an empty response."
    );
  }

  const decodedPayload =
    textDecoder.decode(
      payload
    );

  const parsedPayload =
    JSON.parse(
      decodedPayload
    ) as Partial<HotelProviderResult>;

  if (
    !Array.isArray(
      parsedPayload.hotels
    ) ||
    typeof
      parsedPayload.destination !==
      "string" ||
    typeof
      parsedPayload.resolvedDestination !==
      "string" ||
    typeof
      parsedPayload.hotelBudgetCents !==
      "number"
  ) {
    throw new Error(
      "The hotel provider returned an invalid response."
    );
  }

  return (
    parsedPayload as
      HotelProviderResult
  );
}

function parseProviderError(
  payload: string
): {
  errorType:
    | string
    | null;

  errorMessage:
    | string
    | null;
} {
  if (
    !payload.trim()
  ) {
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
      errorMessage:
        payload
    };
  }
}

function providerErrorResponse(
  providerErrorType:
    | string
    | null,

  providerMessage:
    | string
    | null
): APIGatewayProxyResult {
  const message =
    providerMessage
      ?.trim() ??
    "";

  const normalized =
    message
      .toLowerCase();

  /*
   * Duffel Stays access is enabled separately
   * from Flights. A 403 or permission-related
   * error should not invite the traveler to retry.
   */
  if (
    normalized.includes(
      "403"
    ) ||
    normalized.includes(
      "forbidden"
    ) ||
    normalized.includes(
      "insufficient_permissions"
    ) ||
    normalized.includes(
      "insufficient permissions"
    ) ||
    normalized.includes(
      "not permitted"
    ) ||
    normalized.includes(
      "does not have permission"
    )
  ) {
    return errorResponse(
      503,
      "STAYS_NOT_ENABLED",
      "Hotel search is not available yet",
      "Hotel search is currently unavailable for this trip because the travel provider has not enabled hotel access for this environment. Your flight selections are not affected. Please contact your case manager for assistance.",
      false
    );
  }

  if (
    normalized.includes(
      "check_in_date"
    ) &&
    (
      normalized.includes(
        "must be after"
      ) ||
      normalized.includes(
        "past"
      )
    )
  ) {
    return errorResponse(
      400,
      "PAST_TRAVEL_DATE",
      "These hotel dates have already passed",
      "Hotels can only be searched for future travel. Please contact your case manager to update the trip dates.",
      false
    );
  }

  if (
    normalized.includes(
      "check_out_date"
    ) &&
    normalized.includes(
      "after"
    )
  ) {
    return errorResponse(
      400,
      "INVALID_TRIP_DATES",
      "The hotel dates need to be corrected",
      "The hotel checkout date must be after the check-in date. Please contact your case manager to update the trip dates.",
      false
    );
  }

  /*
   * Mapbox destination resolution failures.
   */
  if (
    normalized.includes(
      "could not locate"
    ) ||
    normalized.includes(
      "could not geocode"
    ) ||
    normalized.includes(
      "destination coordinates"
    ) ||
    normalized.includes(
      "mapbox could not"
    )
  ) {
    return errorResponse(
      400,
      "DESTINATION_NOT_FOUND",
      "We couldn't identify the hotel destination",
      message ||
        "The destination on this trip could not be located. Please contact your case manager to confirm the destination city or address.",
      false
    );
  }

  if (
    normalized.includes(
      "no results"
    ) ||
    normalized.includes(
      "no hotels"
    ) ||
    normalized.includes(
      "no accommodations"
    )
  ) {
    return errorResponse(
      404,
      "NO_HOTELS_FOUND",
      "No hotels were found",
      "No available hotels matched the trip dates, destination, and current hotel preferences. Please contact your case manager if the trip details need to be adjusted.",
      false
    );
  }

  /*
   * Network/provider failures where retrying could
   * reasonably produce a different result.
   */
  if (
    normalized.includes(
      "timeout"
    ) ||
    normalized.includes(
      "timed out"
    ) ||
    normalized.includes(
      "temporarily unavailable"
    ) ||
    normalized.includes(
      "service unavailable"
    ) ||
    normalized.includes(
      "status 500"
    ) ||
    normalized.includes(
      "status 502"
    ) ||
    normalized.includes(
      "status 503"
    ) ||
    normalized.includes(
      "status 504"
    )
  ) {
    return errorResponse(
      503,
      "PROVIDER_UNAVAILABLE",
      "Hotel search is temporarily unavailable",
      "The hotel search service did not respond successfully. Please try again.",
      true
    );
  }

  /*
   * If Duffel explicitly rejects the request for some
   * other validation reason, preserve that detail.
   */
  if (
    providerErrorType ===
      "DuffelApiError" &&
    message
  ) {
    return errorResponse(
      400,
      "PROVIDER_VALIDATION_ERROR",
      "We couldn't complete the hotel search",
      message,
      false
    );
  }

  /*
   * Preserve useful provider text if we have it,
   * while still classifying the failure.
   */
  if (message) {
    return errorResponse(
      502,
      "PROVIDER_UNAVAILABLE",
      "We couldn't complete the hotel search",
      message,
      true
    );
  }

  return errorResponse(
    502,
    "PROVIDER_UNAVAILABLE",
    "Hotel search is temporarily unavailable",
    "We couldn't retrieve hotel options right now. Please try again.",
    true
  );
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const token =
      event
        .pathParameters
        ?.token
        ?.trim();

    if (!token) {
      return errorResponse(
        400,
        "BOOKING_LINK_REQUIRED",
        "Booking link required",
        "A valid booking link is required to search for hotels.",
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

    const hotelProviderFunctionName =
      process.env
        .HOTEL_PROVIDER_FUNCTION_NAME;

    if (
      !hotelProviderFunctionName
    ) {
      return errorResponse(
        500,
        "HOTEL_PROVIDER_NOT_CONFIGURED",
        "Hotel search is unavailable",
        "The hotel search service has not been configured correctly.",
        false
      );
    }

    const tokenHash =
      hashToken(token);

    const result =
      await getPool()
        .query<TripHotelSearchRow>(
          `
            SELECT
              t.trip_reference_id,

              gp.legal_first_name
                AS traveler_first_name,

              gp.legal_last_name
                AS traveler_last_name,

              t.outbound_date,
              t.return_date,

              t.destination_city,
              t.destination_address,

              t.hotel_proximity_preference,
              t.minimum_hotel_star_rating,

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

    const destination =
      buildDestination(
        trip
      );

    if (!destination) {
      return errorResponse(
        400,
        "DESTINATION_MISSING",
        "Destination information is missing",
        "This trip does not have a destination city or address configured. Please contact your case manager to update the trip.",
        false
      );
    }

    const checkInDate =
      normalizeDateValue(
        trip.outbound_date
      );

    const checkOutDate =
      normalizeDateValue(
        trip.return_date
      );

    if (
      checkOutDate <=
      checkInDate
    ) {
      return errorResponse(
        400,
        "INVALID_TRIP_DATES",
        "The hotel dates need to be corrected",
        `The checkout date (${formatDateForMessage(
          checkOutDate
        )}) must be after the check-in date (${formatDateForMessage(
          checkInDate
        )}). Please contact your case manager to update the trip.`,
        false
      );
    }

    const today =
      getTodayDateString();

    if (
      checkInDate <=
      today
    ) {
      return errorResponse(
        400,
        "PAST_TRAVEL_DATE",
        "These hotel dates have already passed",
        `This trip is scheduled for ${formatDateForMessage(
          checkInDate
        )} through ${formatDateForMessage(
          checkOutDate
        )}. Hotel searches can only be performed for future travel. Please contact your case manager to update the trip dates.`,
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

    const hotelBudgetCents =
      Math.max(
        1,

        Math.floor(
          totalTripBudgetCents /
            3
        )
      );

    const minimumStarRating =
      trip
        .minimum_hotel_star_rating ===
      null
        ? undefined
        : Number(
            trip
              .minimum_hotel_star_rating
          );

    if (
      minimumStarRating !==
        undefined &&
      (
        !Number.isInteger(
          minimumStarRating
        ) ||
        minimumStarRating <
          1 ||
        minimumStarRating >
          5
      )
    ) {
      return errorResponse(
        400,
        "INVALID_STAR_RATING",
        "The hotel preference needs to be corrected",
        "The minimum hotel star rating must be between 1 and 5. Please contact your case manager to update the trip.",
        false
      );
    }

    const providerRequest:
      HotelProviderRequest = {
      destination,

      checkInDate,
      checkOutDate,

      adultGuests:
        trip
          .companion_traveler
          ? 2
          : 1,

      rooms: 1,

      radiusKilometers:
        getRadiusKilometers(
          trip
            .hotel_proximity_preference
        ),

      minimumStarRating,

      hotelBudgetCents,

      currency:
        DEFAULT_CURRENCY,

      maximumResults:
        MAXIMUM_HOTEL_RESULTS
    };

    console.log(
      "Invoking hotel provider",
      {
        hotelProviderFunctionName,

        tripReferenceId:
          trip
            .trip_reference_id,

        destination,

        checkInDate:
          providerRequest
            .checkInDate,

        checkOutDate:
          providerRequest
            .checkOutDate,

        adultGuests:
          providerRequest
            .adultGuests,

        radiusKilometers:
          providerRequest
            .radiusKilometers,

        minimumStarRating:
          minimumStarRating ??
          null,

        hotelBudgetCents
      }
    );

    const invokeResponse =
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName:
            hotelProviderFunctionName,

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
              invokeResponse
                .Payload
            )
          : "";

      console.error(
        "Hotel provider returned an error",
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
        providerError
          .errorType,

        providerError
          .errorMessage
      );
    }

    const providerResult =
      parseHotelProviderResult(
        invokeResponse.Payload
      );

    /*
     * A successful provider request with zero inventory
     * is a business result, not a system failure.
     *
     * Return a structured 404 so the portal can explain
     * that retrying the exact same search is not useful.
     */
    if (
      providerResult
        .hotels
        .length === 0
    ) {
      return errorResponse(
        404,
        "NO_HOTELS_FOUND",
        "No hotels were found",
        `No available hotels matched the current trip dates and hotel preferences near ${providerResult.resolvedDestination}. Please contact your case manager if the destination, dates, star rating, or proximity preference should be adjusted.`,
        false
      );
    }

    const travelerName =
      `${trip.traveler_first_name} ` +
      `${trip.traveler_last_name}`;

    const response:
      SearchTripHotelsResult = {
      tripReferenceId:
        trip
          .trip_reference_id,

      travelerName:
        travelerName.trim(),

      destination:
        providerResult
          .resolvedDestination,

      checkInDate:
        providerResult
          .checkInDate,

      checkOutDate:
        providerResult
          .checkOutDate,

      adultGuests:
        providerResult
          .adultGuests,

      rooms:
        providerResult
          .rooms,

      radiusKilometers:
        providerResult
          .radiusKilometers,

      minimumStarRating:
        providerResult
          .minimumStarRating,

      totalTripBudgetCents,

      hotelBudgetCents,

      currency:
        providerResult
          .currency,

      hotels:
        providerResult
          .hotels
    };

    return jsonResponse(
      200,
      response
    );
  } catch (error) {
    const errorDetails =
      getErrorDetails(
        error
      );

    console.error(
      "POST /public/booking-links/{token}/hotels/search failed",
      errorDetails
    );

    if (
      errorDetails.name ===
      "AccessDeniedException"
    ) {
      return errorResponse(
        503,
        "PROVIDER_UNAVAILABLE",
        "Hotel search is temporarily unavailable",
        "The hotel search service is temporarily unavailable. Please try again shortly.",
        true
      );
    }

    if (
      errorDetails.name ===
      "ResourceNotFoundException"
    ) {
      return errorResponse(
        503,
        "PROVIDER_UNAVAILABLE",
        "Hotel search is temporarily unavailable",
        "The hotel search service is temporarily unavailable. Please try again shortly.",
        true
      );
    }

    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "Something went wrong",
      "We couldn't complete the hotel search because of an unexpected error. Please try again. If the problem continues, contact your case manager.",
      true
    );
  }
}