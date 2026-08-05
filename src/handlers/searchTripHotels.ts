import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

import { createHash } from "node:crypto";

import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";

import type {
  HotelProviderRequest,
  HotelProviderResult,
  SearchTripHotelsResult
} from "../types/hotel";

type TripHotelSearchRow = {
  trip_reference_id: string;

  gc_first_name: string;
  gc_last_name: string;

  outbound_date: string;
  return_date: string;

  destination_city: string | null;
  destination_address: string | null;

  hotel_proximity_preference:
    | string
    | null;

  minimum_hotel_star_rating:
    | number
    | null;

  budget_filter: number;
  companion_traveler: boolean;
};

const lambdaClient = new LambdaClient({});
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const DEFAULT_CURRENCY = "USD";
const MAXIMUM_HOTEL_RESULTS = 10;

function hashToken(token: string): string {
  return createHash("sha256")
    .update(token)
    .digest("hex");
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

function normalizeDateValue(
  value: string
): string {
  return value.substring(0, 10);
}

function buildDestination(
  row: TripHotelSearchRow
): string {
  const address =
    row.destination_address?.trim();

  const city =
    row.destination_city?.trim();

  if (address && city) {
    const lowerAddress =
      address.toLowerCase();

    const lowerCity =
      city.toLowerCase();

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

  throw new Error(
    "The trip does not have a destination city or address."
  );
}

function getRadiusKilometers(
  preference: string | null
): number {
  const normalized =
    preference
      ?.trim()
      .toLowerCase() ?? "";

  if (
    normalized.includes("walking")
  ) {
    return 2;
  }

  if (
    normalized.includes("1 mile") ||
    normalized.includes("one mile")
  ) {
    return 2;
  }

  if (
    normalized.includes("5 mile") ||
    normalized.includes("five mile")
  ) {
    return 8;
  }

  if (
    normalized.includes("10 mile") ||
    normalized.includes("ten mile")
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
  payload: Uint8Array | undefined
): HotelProviderResult {
  if (!payload) {
    throw new Error(
      "The hotel provider returned an empty response."
    );
  }

  const decodedPayload =
    textDecoder.decode(payload);

  const parsedPayload = JSON.parse(
    decodedPayload
  ) as Partial<HotelProviderResult>;

  if (
    !Array.isArray(parsedPayload.hotels) ||
    typeof parsedPayload.destination !==
      "string" ||
    typeof
      parsedPayload.resolvedDestination !==
      "string" ||
    typeof parsedPayload.hotelBudgetCents !==
      "number"
  ) {
    throw new Error(
      "The hotel provider returned an invalid response."
    );
  }

  return parsedPayload as HotelProviderResult;
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const token =
      event.pathParameters?.token?.trim();

    if (!token) {
      return jsonResponse(400, {
        message:
          "Booking token is required."
      });
    }

    if (token.length > 200) {
      return jsonResponse(400, {
        message:
          "Booking token is invalid."
      });
    }

    const hotelProviderFunctionName =
      process.env
        .HOTEL_PROVIDER_FUNCTION_NAME;

    if (!hotelProviderFunctionName) {
      return jsonResponse(500, {
        message:
          "The hotel provider has not been configured."
      });
    }

    const tokenHash = hashToken(token);

    const result =
      await getPool()
        .query<TripHotelSearchRow>(
          `
            SELECT
              t.trip_reference_id,

              gp.legal_first_name
                AS gc_first_name,

              gp.legal_last_name
                AS gc_last_name,

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
              ON t.id = bl.trip_id

            JOIN gc_profiles gp
              ON gp.id =
                bl.gc_profile_id

            WHERE
              bl.token_hash = $1
              AND bl.revoked_at IS NULL
              AND bl.expires_at >
                CURRENT_TIMESTAMP

            LIMIT 1;
          `,
          [tokenHash]
        );

    const trip = result.rows[0];

    if (!trip) {
      return jsonResponse(404, {
        message:
          "This booking link is invalid, expired, or has been replaced."
      });
    }

    const destination =
      buildDestination(trip);

    const totalTripBudgetCents =
      Number(trip.budget_filter);

    if (
      !Number.isInteger(
        totalTripBudgetCents
      ) ||
      totalTripBudgetCents <= 0
    ) {
      return jsonResponse(400, {
        message:
          "The trip does not have a valid travel budget."
      });
    }

    const hotelBudgetCents =
      Math.max(
        1,
        Math.floor(
          totalTripBudgetCents / 3
        )
      );

    const minimumStarRating =
      trip.minimum_hotel_star_rating ===
        null
        ? undefined
        : Number(
            trip.minimum_hotel_star_rating
          );

    const providerRequest:
      HotelProviderRequest = {
      destination,

      checkInDate:
        normalizeDateValue(
          trip.outbound_date
        ),

      checkOutDate:
        normalizeDateValue(
          trip.return_date
        ),

      adultGuests:
        trip.companion_traveler
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

      currency: DEFAULT_CURRENCY,

      maximumResults:
        MAXIMUM_HOTEL_RESULTS
    };

    console.log(
      "Invoking hotel provider",
      {
        hotelProviderFunctionName,
        tripReferenceId:
          trip.trip_reference_id,
        destination,
        checkInDate:
          providerRequest.checkInDate,
        checkOutDate:
          providerRequest.checkOutDate,
        adultGuests:
          providerRequest.adultGuests,
        radiusKilometers:
          providerRequest
            .radiusKilometers,
        minimumStarRating:
          minimumStarRating ?? null,
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

          Payload: textEncoder.encode(
            JSON.stringify(
              providerRequest
            )
          )
        })
      );

    if (
      invokeResponse.FunctionError
    ) {
      const errorPayload =
        invokeResponse.Payload
          ? textDecoder.decode(
              invokeResponse.Payload
            )
          : "No error payload returned.";

      console.error(
        "Hotel provider returned an error",
        {
          functionError:
            invokeResponse
              .FunctionError,
          errorPayload
        }
      );

      throw new Error(
        `Hotel provider failed: ${errorPayload}`
      );
    }

    const providerResult =
      parseHotelProviderResult(
        invokeResponse.Payload
      );

    const gcName =
      `${trip.gc_first_name} ` +
      `${trip.gc_last_name}`;

    const response:
      SearchTripHotelsResult = {
      tripReferenceId:
        trip.trip_reference_id,

      gcName: gcName.trim(),

      destination:
        providerResult
          .resolvedDestination,

      checkInDate:
        providerResult.checkInDate,

      checkOutDate:
        providerResult.checkOutDate,

      adultGuests:
        providerResult.adultGuests,

      rooms:
        providerResult.rooms,

      radiusKilometers:
        providerResult
          .radiusKilometers,

      minimumStarRating:
        providerResult
          .minimumStarRating,

      totalTripBudgetCents,
      hotelBudgetCents,

      currency:
        providerResult.currency,

      hotels:
        providerResult.hotels
    };

    return jsonResponse(200, response);
  } catch (error) {
    const errorDetails =
      getErrorDetails(error);

    console.error(
      "POST /public/booking-links/{token}/hotels/search failed",
      errorDetails
    );

    if (
      errorDetails.name ===
      "AccessDeniedException"
    ) {
      return jsonResponse(500, {
        message:
          "The hotel-search Lambda does not have permission to invoke the hotel provider.",
        error:
          errorDetails.name
      });
    }

    if (
      errorDetails.name ===
      "ResourceNotFoundException"
    ) {
      return jsonResponse(500, {
        message:
          "The configured hotel provider Lambda could not be found.",
        error:
          errorDetails.name
      });
    }

    return jsonResponse(500, {
      message:
        "Unable to search for hotels.",
      error:
        errorDetails.name
    });
  }
}