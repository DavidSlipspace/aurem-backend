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

type UpdateTripRequest = {
  caseId: string;

  travelerProfileId:
    string;

  tripPurpose: string;

  outboundDate: string;

  returnDate: string;

  outboundAirport:
    string;

  returnAirport:
    string;

  destinationCity?:
    string;

  destinationAddress?:
    string;

  hotelProximityPreference?:
    string;

  minimumHotelStarRating?:
    number;

  budgetFilter: number;

  companionTraveler:
    boolean;

  ipcmApprovalRequired:
    boolean;

  status?: string;
};

type CaseAccessRow = {
  id: string;

  ipcm_user_id:
    string;
};

export async function handler(
  event:
    APIGatewayProxyEvent
): Promise<
  APIGatewayProxyResult
> {
  try {
    const currentUser =
      await getCurrentUser(
        event
      );

    if (
      !currentUser
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Authenticated user does not exist in Aurem database."
        }
      );
    }

    if (
      ![
        "admin",
        "case_manager"
      ].includes(
        currentUser.roleName
      )
    ) {
      return jsonResponse(
        403,
        {
          message:
            "User role is not authorized to update trips."
        }
      );
    }

    const tripId =
      event.pathParameters
        ?.id;

    if (
      !tripId
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Missing trip ID."
        }
      );
    }

    const body =
      JSON.parse(
        event.body ??
          "{}"
      ) as
        UpdateTripRequest;

    if (
      !body.caseId ||
      !body.travelerProfileId ||
      !body.tripPurpose ||
      !body.outboundDate ||
      !body.returnDate ||
      !body.outboundAirport ||
      !body.returnAirport ||
      body.budgetFilter ===
        undefined
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Missing required fields."
        }
      );
    }

    const pool =
      getPool();

    const existingAccess =
      await pool.query(
        `
        SELECT
          t.id

        FROM trips t

        JOIN cases c
          ON c.id =
            t.case_id

        WHERE
          t.id = $1

          AND (
            (
              $2 = 'admin'

              AND
              c.company_id = $3
            )

            OR

            (
              $2 = 'case_manager'

              AND
              c.case_manager_user_id = $4
            )
          )

        LIMIT 1;
        `,
        [
          tripId,

          currentUser.roleName,

          currentUser.companyId,

          currentUser.id
        ]
      );

    if (
      existingAccess.rowCount ===
      0
    ) {
      return jsonResponse(
        404,
        {
          message:
            "Trip not found or user is not authorized to update it."
        }
      );
    }

    const caseAccessResult =
      await pool.query<
        CaseAccessRow
      >(
        `
        SELECT
          c.id,
          c.ipcm_user_id

        FROM cases c

        WHERE
          c.id = $1

          AND (
            (
              $2 = 'admin'

              AND
              c.company_id = $3
            )

            OR

            (
              $2 = 'case_manager'

              AND
              c.case_manager_user_id = $4
            )
          )

        LIMIT 1;
        `,
        [
          body.caseId,

          currentUser.roleName,

          currentUser.companyId,

          currentUser.id
        ]
      );

    const accessibleCase =
      caseAccessResult
        .rows[0];

    if (
      !accessibleCase
    ) {
      return jsonResponse(
        403,
        {
          message:
            "User is not authorized to use the selected case."
        }
      );
    }

    const travelerResult =
      await pool.query(
        `
        SELECT id

        FROM traveler_profiles

        WHERE
          id = $1

          AND
          company_id = $2

          AND
          status = 'active'

        LIMIT 1;
        `,
        [
          body.travelerProfileId,

          currentUser.companyId
        ]
      );

    if (
      travelerResult.rowCount ===
      0
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Traveler profile not found or inactive."
        }
      );
    }

    const result =
      await pool.query(
        `
        UPDATE trips

        SET
          case_id = $1,

          traveler_profile_id = $2,

          ipcm_user_id = $3,

          trip_purpose = $4,

          outbound_date = $5,

          return_date = $6,

          outbound_airport = $7,

          return_airport = $8,

          destination_city = $9,

          destination_address = $10,

          hotel_proximity_preference = $11,

          minimum_hotel_star_rating = $12,

          budget_filter = $13,

          companion_traveler = $14,

          ipcm_approval_required = $15,

          status =
            COALESCE(
              $16,
              status
            ),

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          id = $17

        RETURNING id;
        `,
        [
          body.caseId,

          body.travelerProfileId,

          accessibleCase
            .ipcm_user_id,

          body.tripPurpose,

          body.outboundDate,

          body.returnDate,

          body.outboundAirport,

          body.returnAirport,

          body.destinationCity ??
            null,

          body.destinationAddress ??
            null,

          body.hotelProximityPreference ??
            null,

          body.minimumHotelStarRating ??
            null,

          body.budgetFilter,

          body.companionTraveler ??
            false,

          body.ipcmApprovalRequired ??
            false,

          body.status ??
            null,

          tripId
        ]
      );

    return jsonResponse(
      200,
      {
        id:
          result.rows[0].id,

        message:
          "Trip updated."
      }
    );
  } catch (
    error
  ) {
    console.error(
      "PUT /trips/{id} error",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to update trip."
      }
    );
  }
}