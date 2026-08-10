import type {
  FlightProviderResult
} from "../types/flight";

import {
  isFlightProviderRequest,
  searchFlights
} from "../providers/duffel/flights";

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
): Promise<FlightProviderResult> {
  console.log(
    "Flight provider request received"
  );

  if (
    !isFlightProviderRequest(
      event
    )
  ) {
    throw new Error(
      "Flight provider received an invalid request."
    );
  }

  const duffelAccessToken =
    process.env
      .DUFFEL_ACCESS_TOKEN;

  if (!duffelAccessToken) {
    throw new Error(
      "DUFFEL_ACCESS_TOKEN is not configured."
    );
  }

  try {
    const result =
      await searchFlights(
        event,
        duffelAccessToken
      );

    console.log(
      "Flight provider search completed",
      {
        origin:
          result
            .originAirportCode,

        destination:
          result
            .destinationCode,

        returnAirport:
          result
            .returnAirportCode,

        returnedResultCount:
          result.flights.length
      }
    );

    return result;
  } catch (error) {
    console.error(
      "Flight provider failed",
      getErrorDetails(error)
    );

    throw error;
  }
}