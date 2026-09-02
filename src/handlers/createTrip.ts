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

type CreateTripRequest = {
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
};

type CaseAccessRow = {
  id: string;

  ipcm_user_id:
    string;
};

function buildTripReferenceId():
  string {
  return (
    `TRIP-` +
    `${new Date().getFullYear()}-` +
    `${Date.now()}`
  );
}

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
            "User role is not authorized to create trips."
        }
      );
    }

    const body =
      JSON.parse(
        event.body ??
          "{}"
      ) as
        CreateTripRequest;

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
            "User is not authorized to create a trip for this case."
        }
      );
    }

    const travelerAccessResult =
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
      travelerAccessResult.rowCount ===
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
        INSERT INTO trips (
          trip_reference_id,
          case_id,
          traveler_profile_id,
          ipcm_user_id,
          trip_purpose,
          status,
          outbound_date,
          return_date,
          outbound_airport,
          return_airport,
          destination_city,
          destination_address,
          hotel_proximity_preference,
          minimum_hotel_star_rating,
          budget_filter,
          companion_traveler,
          ipcm_approval_required
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'Created',
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16
        )
        RETURNING
          id,
          trip_reference_id;
        `,
        [
          buildTripReferenceId(),

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
            false
        ]
      );

    return jsonResponse(
      201,
      {
        id:
          result.rows[0].id,

        tripReferenceId:
          result.rows[0]
            .trip_reference_id,

        message:
          "Trip created."
      }
    );
  } catch (
    error
  ) {
    console.error(
      "POST /trips error",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to create trip."
      }
    );
  }
}