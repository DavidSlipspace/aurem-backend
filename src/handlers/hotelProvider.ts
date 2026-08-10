import type {
  HotelProviderResult
} from "../types/hotel";

import {
  isHotelProviderRequest,
  searchStays
} from "../providers/duffel/stays";

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

export async function handler(
  event: unknown
): Promise<HotelProviderResult> {
  console.log(
    "Hotel provider request received"
  );

  if (
    !isHotelProviderRequest(
      event
    )
  ) {
    throw new Error(
      "Hotel provider received an invalid request."
    );
  }

  const duffelAccessToken =
    process.env
      .DUFFEL_ACCESS_TOKEN;

  const mapboxAccessToken =
    process.env
      .MAPBOX_ACCESS_TOKEN;

  if (!duffelAccessToken) {
    throw new Error(
      "DUFFEL_ACCESS_TOKEN is not configured."
    );
  }

  if (!mapboxAccessToken) {
    throw new Error(
      "MAPBOX_ACCESS_TOKEN is not configured."
    );
  }

  try {
    const result =
      await searchStays(
        event,
        duffelAccessToken,
        mapboxAccessToken
      );

    console.log(
      "Hotel provider search completed",
      {
        destination:
          result.destination,

        resolvedDestination:
          result
            .resolvedDestination,

        returnedResultCount:
          result.hotels.length
      }
    );

    return result;
  } catch (error) {
    console.error(
      "Hotel provider failed",
      getErrorDetails(error)
    );

    throw error;
  }
}