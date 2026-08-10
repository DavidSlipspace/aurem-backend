import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  getPool
} from "../db/pool";

import {
  jsonResponse
} from "../common/response";

import {
  getCurrentUser
} from "../common/currentUser";

type TripRow = {
  id: string;
  trip_reference_id: string;

  case_id: string;
  case_reference_id: string;

  gc_profile_id: string;
  gc_first_name: string;
  gc_last_name: string;
  gc_email: string;

  trip_purpose: string;
  status: string;

  outbound_date: string;
  return_date: string;

  outbound_airport: string;
  return_airport: string;

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

  ipcm_approval_required: boolean;

  selected_flight_offer_id:
    | string
    | null;

  selected_flight_airline:
    | string
    | null;

  selected_flight_origin:
    | string
    | null;

  selected_flight_destination:
    | string
    | null;

  selected_flight_return_origin:
    | string
    | null;

  selected_flight_return_destination:
    | string
    | null;

  selected_flight_outbound_departure:
    | string
    | null;

  selected_flight_return_departure:
    | string
    | null;

  selected_flight_price:
    | number
    | null;

  selected_flight_currency:
    | string
    | null;

  selected_flight_approval_status:
    | string
    | null;

  selected_flight_booking_status:
    | string
    | null;

  selected_hotel_offer_id:
    | string
    | null;

  selected_hotel_name:
    | string
    | null;

  selected_hotel_address:
    | string
    | null;

  selected_hotel_check_in:
    | string
    | null;

  selected_hotel_check_out:
    | string
    | null;

  selected_hotel_price:
    | number
    | null;

  selected_hotel_currency:
    | string
    | null;

  selected_hotel_approval_status:
    | string
    | null;

  selected_hotel_booking_status:
    | string
    | null;
};

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const currentUser =
      await getCurrentUser(
        event
      );

    if (!currentUser) {
      return jsonResponse(
        403,
        {
          message:
            "Authenticated user does not exist in Aurem database."
        }
      );
    }

    let whereClause = "";

    const params:
      string[] = [];

    if (
      currentUser.roleName ===
      "admin"
    ) {
      whereClause =
        "cm.company_id = $1";

      params.push(
        currentUser.companyId
      );
    } else if (
      currentUser.roleName ===
      "case_manager"
    ) {
      whereClause =
        "c.case_manager_user_id = $1";

      params.push(
        currentUser.id
      );
    } else if (
      currentUser.roleName ===
      "ipcm"
    ) {
      whereClause =
        "c.ip_user_id = $1";

      params.push(
        currentUser.id
      );
    } else {
      return jsonResponse(
        403,
        {
          message:
            "User role is not authorized to view trips."
        }
      );
    }

    const result =
      await getPool()
        .query<TripRow>(
          `
            SELECT
              t.id,
              t.trip_reference_id,

              t.case_id,
              c.case_reference_id,

              t.gc_profile_id,

              gp.legal_first_name
                AS gc_first_name,

              gp.legal_last_name
                AS gc_last_name,

              gp.email
                AS gc_email,

              t.trip_purpose,
              t.status,

              t.outbound_date,
              t.return_date,

              t.outbound_airport,
              t.return_airport,

              t.destination_city,
              t.destination_address,

              t.hotel_proximity_preference,
              t.minimum_hotel_star_rating,

              t.budget_filter,
              t.companion_traveler,
              t.ipcm_approval_required,

              outbound_flight.provider_offer_id
                AS selected_flight_offer_id,

              outbound_flight.airline
                AS selected_flight_airline,

              outbound_flight.departure_airport
                AS selected_flight_origin,

              outbound_flight.arrival_airport
                AS selected_flight_destination,

              return_flight.departure_airport
                AS selected_flight_return_origin,

              return_flight.arrival_airport
                AS selected_flight_return_destination,

              outbound_flight.departure_datetime
                AS selected_flight_outbound_departure,

              return_flight.departure_datetime
                AS selected_flight_return_departure,

              CASE
                WHEN
                  outbound_flight.id
                  IS NOT NULL
                THEN
                  outbound_flight.price +
                  COALESCE(
                    return_flight.price,
                    0
                  )
                ELSE NULL
              END
                AS selected_flight_price,

              outbound_flight.currency
                AS selected_flight_currency,

              outbound_flight.approval_status
                AS selected_flight_approval_status,

              outbound_flight.booking_status
                AS selected_flight_booking_status,

              hotel.provider_offer_id
                AS selected_hotel_offer_id,

              hotel.hotel_name
                AS selected_hotel_name,

              hotel.hotel_address
                AS selected_hotel_address,

              hotel.check_in_date
                AS selected_hotel_check_in,

              hotel.check_out_date
                AS selected_hotel_check_out,

              hotel.price
                AS selected_hotel_price,

              hotel.currency
                AS selected_hotel_currency,

              hotel.approval_status
                AS selected_hotel_approval_status,

              hotel.booking_status
                AS selected_hotel_booking_status

            FROM trips t

            JOIN cases c
              ON c.id =
                t.case_id

            JOIN users cm
              ON cm.id =
                c.case_manager_user_id

            JOIN gc_profiles gp
              ON gp.id =
                t.gc_profile_id

            LEFT JOIN trip_flights
              outbound_flight
              ON
                outbound_flight.trip_id =
                  t.id

                AND
                  outbound_flight.direction =
                    'outbound'

            LEFT JOIN trip_flights
              return_flight
              ON
                return_flight.trip_id =
                  t.id

                AND
                  return_flight.direction =
                    'return'

            LEFT JOIN trip_hotels hotel
              ON
                hotel.trip_id =
                  t.id

            WHERE
              ${whereClause}

            ORDER BY
              t.created_at DESC;
          `,
          params
        );

    return jsonResponse(
      200,
      {
        trips:
          result.rows.map(
            (row) => ({
              id:
                row.id,

              tripReferenceId:
                row
                  .trip_reference_id,

              caseId:
                row.case_id,

              caseReferenceId:
                row
                  .case_reference_id,

              gcProfileId:
                row
                  .gc_profile_id,

              gcName:
                `${row.gc_first_name} ${row.gc_last_name}`.trim(),

              gcEmail:
                row.gc_email,

              tripPurpose:
                row.trip_purpose,

              status:
                row.status,

              outboundDate:
                row.outbound_date,

              returnDate:
                row.return_date,

              outboundAirport:
                row
                  .outbound_airport,

              returnAirport:
                row
                  .return_airport,

              destinationCity:
                row
                  .destination_city,

              destinationAddress:
                row
                  .destination_address,

              hotelProximityPreference:
                row
                  .hotel_proximity_preference,

              minimumHotelStarRating:
                row
                  .minimum_hotel_star_rating,

              budgetFilter:
                Number(
                  row.budget_filter
                ),

              companionTraveler:
                row
                  .companion_traveler,

              ipcmApprovalRequired:
                row
                  .ipcm_approval_required,

              selectedFlight:
                row
                  .selected_flight_offer_id
                  ? {
                      offerId:
                        row
                          .selected_flight_offer_id,

                      airline:
                        row
                          .selected_flight_airline,

                      originAirport:
                        row
                          .selected_flight_origin,

                      destinationAirport:
                        row
                          .selected_flight_destination,

                      returnOriginAirport:
                        row
                          .selected_flight_return_origin,

                      returnDestinationAirport:
                        row
                          .selected_flight_return_destination,

                      outboundDepartureAt:
                        row
                          .selected_flight_outbound_departure,

                      returnDepartureAt:
                        row
                          .selected_flight_return_departure,

                      price:
                        Number(
                          row
                            .selected_flight_price ??
                            0
                        ),

                      currency:
                        row
                          .selected_flight_currency ??
                        "USD",

                      approvalStatus:
                        row
                          .selected_flight_approval_status,

                      bookingStatus:
                        row
                          .selected_flight_booking_status
                    }
                  : null,

              selectedHotel:
                row
                  .selected_hotel_offer_id
                  ? {
                      offerId:
                        row
                          .selected_hotel_offer_id,

                      name:
                        row
                          .selected_hotel_name,

                      address:
                        row
                          .selected_hotel_address,

                      checkInDate:
                        row
                          .selected_hotel_check_in,

                      checkOutDate:
                        row
                          .selected_hotel_check_out,

                      price:
                        Number(
                          row
                            .selected_hotel_price ??
                            0
                        ),

                      currency:
                        row
                          .selected_hotel_currency ??
                        "USD",

                      approvalStatus:
                        row
                          .selected_hotel_approval_status,

                      bookingStatus:
                        row
                          .selected_hotel_booking_status
                    }
                  : null
            })
          )
      }
    );
  } catch (error) {
    console.error(
      "GET /trips error",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to load trips."
      }
    );
  }
}