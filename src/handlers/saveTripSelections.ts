import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

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
  FlightOption,
  FlightJourney
} from "../types/flight";

import type {
  HotelOption
} from "../types/hotel";

type SaveSelectionsRequest = {
  flight: FlightOption;
  hotel: HotelOption;
};

type BookingLinkTripRow = {
  booking_link_id: string;
  trip_id: string;
  trip_reference_id: string;

  used_at: string | null;

  outbound_date:
    | Date
    | string;

  return_date:
    | Date
    | string;

  outbound_airport: string;
  return_airport: string;

  ipcm_approval_required: boolean;
};

function hashToken(
  token: string
): string {
  return createHash(
    "sha256"
  )
    .update(token)
    .digest("hex");
}

function isRecord(
  value: unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isFlightJourney(
  value: unknown
): value is FlightJourney {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.originAirportCode ===
      "string" &&
    typeof value.destinationAirportCode ===
      "string" &&
    typeof value.departingAt ===
      "string" &&
    typeof value.arrivingAt ===
      "string" &&
    Array.isArray(
      value.segments
    )
  );
}

function isFlightOption(
  value: unknown
): value is FlightOption {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.offerId ===
      "string" &&
    value.offerId.length > 0 &&

    typeof value.ownerName ===
      "string" &&
    value.ownerName.length > 0 &&

    typeof value.totalAmountCents ===
      "number" &&
    Number.isInteger(
      value.totalAmountCents
    ) &&
    value.totalAmountCents > 0 &&

    typeof value.currency ===
      "string" &&

    isFlightJourney(
      value.outbound
    ) &&

    isFlightJourney(
      value.return
    )
  );
}

function isHotelOption(
  value: unknown
): value is HotelOption {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.searchResultId ===
      "string" &&
    value.searchResultId.length > 0 &&

    typeof value.accommodationId ===
      "string" &&
    value.accommodationId.length > 0 &&

    typeof value.name ===
      "string" &&
    value.name.length > 0 &&

    typeof value.address ===
      "string" &&

    typeof value.cheapestTotalAmountCents ===
      "number" &&
    Number.isInteger(
      value.cheapestTotalAmountCents
    ) &&
    value.cheapestTotalAmountCents > 0 &&

    typeof value.currency ===
      "string"
  );
}

function parseRequest(
  event: APIGatewayProxyEvent
): SaveSelectionsRequest | null {
  if (!event.body) {
    return null;
  }

  try {
    const body =
      JSON.parse(
        event.body
      ) as unknown;

    if (!isRecord(body)) {
      return null;
    }

    if (
      !isFlightOption(
        body.flight
      ) ||
      !isHotelOption(
        body.hotel
      )
    ) {
      return null;
    }

    return {
      flight:
        body.flight,

      hotel:
        body.hotel
    };
  } catch {
    return null;
  }
}

function normalizeDateValue(
  value:
    | Date
    | string
): string {
  if (
    value instanceof Date
  ) {
    return value
      .toISOString()
      .substring(0, 10);
  }

  return value
    .substring(0, 10);
}

function normalizeAirport(
  value: string
): string {
  return value
    .trim()
    .toUpperCase();
}

function getJourneyFlightNumbers(
  journey: FlightJourney
): string | null {
  const numbers =
    journey.segments
      .map(
        (segment) =>
          segment.flightNumber
            ?.trim()
      )
      .filter(
        (
          value
        ): value is string =>
          Boolean(value)
      )
      .join(", ");

  if (!numbers) {
    return null;
  }

  return numbers.substring(
    0,
    50
  );
}

function differenceInDays(
  startDate: string,
  endDate: string
): number {
  const start =
    Date.parse(
      `${startDate}T00:00:00Z`
    );

  const end =
    Date.parse(
      `${endDate}T00:00:00Z`
    );

  return Math.max(
    1,
    Math.round(
      (
        end -
        start
      ) /
        86_400_000
    )
  );
}

function errorResponse(
  statusCode: number,
  code: string,
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

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const token =
    event.pathParameters
      ?.token
      ?.trim();

  if (!token) {
    return errorResponse(
      400,
      "BOOKING_LINK_REQUIRED",
      "Booking link required",
      "A valid booking link is required to submit your selections."
    );
  }

  if (
    token.length > 200
  ) {
    return errorResponse(
      400,
      "BOOKING_LINK_INVALID",
      "Booking link invalid",
      "This booking link is not valid."
    );
  }

  const request =
    parseRequest(
      event
    );

  if (!request) {
    return errorResponse(
      400,
      "INVALID_SELECTIONS",
      "Your selections could not be submitted",
      "Both a valid flight and hotel selection are required."
    );
  }

  const pool =
    getPool();

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const tokenHash =
      hashToken(token);

    /*
     * Lock the booking link while the selections are saved.
     * This prevents two browser requests from submitting the
     * same one-time booking link simultaneously.
     */
    const bookingResult =
      await client
        .query<BookingLinkTripRow>(
          `
            SELECT
              bl.id
                AS booking_link_id,

              bl.trip_id,

              bl.used_at,

              t.trip_reference_id,

              t.outbound_date,
              t.return_date,

              t.outbound_airport,
              t.return_airport,

              t.ipcm_approval_required

            FROM booking_links bl

            JOIN trips t
              ON t.id =
                bl.trip_id

            WHERE
              bl.token_hash = $1

              AND
                bl.revoked_at
                IS NULL

              AND
                bl.expires_at >
                CURRENT_TIMESTAMP

            LIMIT 1

            FOR UPDATE OF bl;
          `,
          [
            tokenHash
          ]
        );

    const booking =
      bookingResult.rows[0];

    if (!booking) {
      await client.query(
        "ROLLBACK"
      );

      return errorResponse(
        404,
        "BOOKING_LINK_EXPIRED",
        "This booking link is no longer available",
        "The link may have expired or been replaced. Please contact your case manager for a new link."
      );
    }

    if (
      booking.used_at
    ) {
      await client.query(
        "ROLLBACK"
      );

      return errorResponse(
        409,
        "SELECTIONS_ALREADY_SUBMITTED",
        "Your selections were already submitted",
        "This booking link has already been used. No additional action is required."
      );
    }

    const outboundDate =
      normalizeDateValue(
        booking.outbound_date
      );

    const returnDate =
      normalizeDateValue(
        booking.return_date
      );

    const outbound =
      request.flight
        .outbound;

    const returnJourney =
      request.flight
        .return;

    /*
     * Perform some basic server-side validation against
     * authoritative trip data.
     *
     * Provider availability will be revalidated later
     * before an actual purchase is made.
     */
    if (
      normalizeAirport(
        outbound.originAirportCode
      ) !==
      normalizeAirport(
        booking.outbound_airport
      )
    ) {
      await client.query(
        "ROLLBACK"
      );

      return errorResponse(
        400,
        "FLIGHT_DOES_NOT_MATCH_TRIP",
        "The selected flight does not match this trip",
        "The departure airport on the selected flight does not match the trip. Please choose another flight."
      );
    }

    if (
      normalizeAirport(
        returnJourney
          .destinationAirportCode
      ) !==
      normalizeAirport(
        booking.return_airport
      )
    ) {
      await client.query(
        "ROLLBACK"
      );

      return errorResponse(
        400,
        "FLIGHT_DOES_NOT_MATCH_TRIP",
        "The selected flight does not match this trip",
        "The return destination on the selected flight does not match the trip. Please choose another flight."
      );
    }

    if (
      outbound.departingAt
        .substring(
          0,
          10
        ) !==
      outboundDate
    ) {
      await client.query(
        "ROLLBACK"
      );

      return errorResponse(
        400,
        "FLIGHT_DATE_MISMATCH",
        "The selected flight no longer matches the trip",
        "The outbound flight date does not match the trip's outbound date. Please search again."
      );
    }

    if (
      returnJourney
        .departingAt
        .substring(
          0,
          10
        ) !==
      returnDate
    ) {
      await client.query(
        "ROLLBACK"
      );

      return errorResponse(
        400,
        "FLIGHT_DATE_MISMATCH",
        "The selected flight no longer matches the trip",
        "The return flight date does not match the trip's return date. Please search again."
      );
    }

    const approvalStatus =
      booking
        .ipcm_approval_required
        ? "Pending Approval"
        : "Not Required";

    const nextTripStatus =
      booking
        .ipcm_approval_required
        ? "Awaiting IPCM Approval"
        : "Booking In Progress";

    /*
     * Duffel gives us one total for the round-trip offer.
     * Split it across the two directional rows so summing
     * trip_flights.price gives us the exact round-trip total.
     */
    const outboundPrice =
      Math.floor(
        request.flight
          .totalAmountCents /
          2
      );

    const returnPrice =
      request.flight
        .totalAmountCents -
      outboundPrice;

    const selectedFlightJson =
      JSON.stringify(
        request.flight
      );

    const selectedHotelJson =
      JSON.stringify(
        request.hotel
      );

    await client.query(
      `
        INSERT INTO trip_flights (
          trip_id,
          direction,
          provider,
          provider_offer_id,
          airline,
          flight_number,
          departure_airport,
          arrival_airport,
          departure_datetime,
          arrival_datetime,
          price,
          currency,
          approval_status,
          booking_status,
          selected_offer,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          'outbound',
          'duffel',
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          'Pending',
          $12::jsonb,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (
          trip_id,
          direction
        )
        DO UPDATE SET
          provider =
            EXCLUDED.provider,

          provider_offer_id =
            EXCLUDED.provider_offer_id,

          airline =
            EXCLUDED.airline,

          flight_number =
            EXCLUDED.flight_number,

          departure_airport =
            EXCLUDED.departure_airport,

          arrival_airport =
            EXCLUDED.arrival_airport,

          departure_datetime =
            EXCLUDED.departure_datetime,

          arrival_datetime =
            EXCLUDED.arrival_datetime,

          price =
            EXCLUDED.price,

          currency =
            EXCLUDED.currency,

          approval_status =
            EXCLUDED.approval_status,

          booking_status =
            EXCLUDED.booking_status,

          confirmation_number =
            NULL,

          provider_booking_reference =
            NULL,

          selected_offer =
            EXCLUDED.selected_offer,

          updated_at =
            CURRENT_TIMESTAMP;
      `,
      [
        booking.trip_id,

        request.flight
          .offerId,

        request.flight
          .ownerName,

        getJourneyFlightNumbers(
          outbound
        ),

        outbound
          .originAirportCode,

        outbound
          .destinationAirportCode,

        outbound
          .departingAt,

        outbound
          .arrivingAt,

        outboundPrice,

        request.flight
          .currency,

        approvalStatus,

        selectedFlightJson
      ]
    );

    await client.query(
      `
        INSERT INTO trip_flights (
          trip_id,
          direction,
          provider,
          provider_offer_id,
          airline,
          flight_number,
          departure_airport,
          arrival_airport,
          departure_datetime,
          arrival_datetime,
          price,
          currency,
          approval_status,
          booking_status,
          selected_offer,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          'return',
          'duffel',
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          'Pending',
          $12::jsonb,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (
          trip_id,
          direction
        )
        DO UPDATE SET
          provider =
            EXCLUDED.provider,

          provider_offer_id =
            EXCLUDED.provider_offer_id,

          airline =
            EXCLUDED.airline,

          flight_number =
            EXCLUDED.flight_number,

          departure_airport =
            EXCLUDED.departure_airport,

          arrival_airport =
            EXCLUDED.arrival_airport,

          departure_datetime =
            EXCLUDED.departure_datetime,

          arrival_datetime =
            EXCLUDED.arrival_datetime,

          price =
            EXCLUDED.price,

          currency =
            EXCLUDED.currency,

          approval_status =
            EXCLUDED.approval_status,

          booking_status =
            EXCLUDED.booking_status,

          confirmation_number =
            NULL,

          provider_booking_reference =
            NULL,

          selected_offer =
            EXCLUDED.selected_offer,

          updated_at =
            CURRENT_TIMESTAMP;
      `,
      [
        booking.trip_id,

        request.flight
          .offerId,

        request.flight
          .ownerName,

        getJourneyFlightNumbers(
          returnJourney
        ),

        returnJourney
          .originAirportCode,

        returnJourney
          .destinationAirportCode,

        returnJourney
          .departingAt,

        returnJourney
          .arrivingAt,

        returnPrice,

        request.flight
          .currency,

        approvalStatus,

        selectedFlightJson
      ]
    );

    const numberOfNights =
      differenceInDays(
        outboundDate,
        returnDate
      );

    await client.query(
      `
        INSERT INTO trip_hotels (
          trip_id,
          provider,
          provider_hotel_id,
          provider_offer_id,
          hotel_name,
          hotel_address,
          room_type,
          check_in_date,
          check_out_date,
          number_of_nights,
          price,
          currency,
          approval_status,
          booking_status,
          selected_offer,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          'duffel',
          $2,
          $3,
          $4,
          $5,
          NULL,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          'Pending',
          $12::jsonb,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (
          trip_id
        )
        DO UPDATE SET
          provider =
            EXCLUDED.provider,

          provider_hotel_id =
            EXCLUDED.provider_hotel_id,

          provider_offer_id =
            EXCLUDED.provider_offer_id,

          hotel_name =
            EXCLUDED.hotel_name,

          hotel_address =
            EXCLUDED.hotel_address,

          room_type =
            EXCLUDED.room_type,

          check_in_date =
            EXCLUDED.check_in_date,

          check_out_date =
            EXCLUDED.check_out_date,

          number_of_nights =
            EXCLUDED.number_of_nights,

          price =
            EXCLUDED.price,

          currency =
            EXCLUDED.currency,

          approval_status =
            EXCLUDED.approval_status,

          booking_status =
            EXCLUDED.booking_status,

          confirmation_number =
            NULL,

          provider_booking_reference =
            NULL,

          selected_offer =
            EXCLUDED.selected_offer,

          updated_at =
            CURRENT_TIMESTAMP;
      `,
      [
        booking.trip_id,

        request.hotel
          .accommodationId,

        request.hotel
          .searchResultId,

        request.hotel
          .name,

        request.hotel
          .address,

        outboundDate,

        returnDate,

        numberOfNights,

        request.hotel
          .cheapestTotalAmountCents,

        request.hotel
          .currency,

        approvalStatus,

        selectedHotelJson
      ]
    );

    await client.query(
      `
        UPDATE trips
        SET
          status = $2,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = $1;
      `,
      [
        booking.trip_id,
        nextTripStatus
      ]
    );

    await client.query(
      `
        UPDATE booking_links
        SET
          used_at =
            CURRENT_TIMESTAMP,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = $1;
      `,
      [
        booking
          .booking_link_id
      ]
    );

    await client.query(
      "COMMIT"
    );

    return jsonResponse(
      200,
      {
        message:
          "Travel selections submitted successfully.",

        tripId:
          booking.trip_id,

        tripReferenceId:
          booking
            .trip_reference_id,

        status:
          nextTripStatus,

        ipcmApprovalRequired:
          booking
            .ipcm_approval_required
      }
    );
  } catch (error) {
    await client.query(
      "ROLLBACK"
    );

    console.error(
      "POST /public/booking-links/{token}/selections failed",
      error
    );

    return errorResponse(
      500,
      "SELECTION_SAVE_FAILED",
      "We couldn't save your selections",
      "Your flight and hotel choices were not submitted. Please try again.",
      true
    );
  } finally {
    client.release();
  }
}