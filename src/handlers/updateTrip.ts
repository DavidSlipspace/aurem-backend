import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";
import { getCurrentUser } from "../common/currentUser";

type UpdateTripRequest = {
  caseId: string;
  travelerProfileId: string;
  tripPurpose: string;
  outboundDate: string;
  returnDate: string;
  outboundAirport: string;
  returnAirport: string;
  destinationCity?: string;
  destinationAddress?: string;
  hotelProximityPreference?: string;
  minimumHotelStarRating?: number;
  budgetFilter: number;
  companionTraveler: boolean;
  status?: string;
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const currentUser = await getCurrentUser(event);

    if (!currentUser) {
      return jsonResponse(403, {
        message: "Authenticated user does not exist in Aurem database."
      });
    }

    if (!["admin", "case_manager"].includes(currentUser.roleName)) {
      return jsonResponse(403, {
        message: "User role is not authorized to update trips."
      });
    }

    const tripId = event.pathParameters?.id;

    if (!tripId) {
      return jsonResponse(400, {
        message: "Missing trip ID."
      });
    }

    const body = JSON.parse(event.body ?? "{}") as UpdateTripRequest;

    if (
      !body.caseId ||
      !body.travelerProfileId ||
      !body.tripPurpose ||
      !body.outboundDate ||
      !body.returnDate ||
      !body.outboundAirport ||
      !body.returnAirport ||
      body.budgetFilter === undefined
    ) {
      return jsonResponse(400, {
        message: "Missing required fields."
      });
    }

    const pool = getPool();

    const result = await pool.query(
      `
      UPDATE trips t
      SET
        case_id = $1,
        traveler_profile_id = $2,
        trip_purpose = $3,
        outbound_date = $4,
        return_date = $5,
        outbound_airport = $6,
        return_airport = $7,
        destination_city = $8,
        destination_address = $9,
        hotel_proximity_preference = $10,
        minimum_hotel_star_rating = $11,
        budget_filter = $12,
        companion_traveler = $13,
        status = COALESCE($14, t.status),
        updated_at = CURRENT_TIMESTAMP
      FROM cases c
      JOIN users cm ON cm.id = c.case_manager_user_id
      JOIN traveler_profiles gp ON gp.id = $2
      WHERE t.id = $15
        AND c.id = $1
        AND t.case_id = c.id
        AND gp.company_id = $16
        AND (
          ($17 = 'admin' AND cm.company_id = $16)
          OR ($17 = 'case_manager' AND c.case_manager_user_id = $18)
        )
      RETURNING t.id;
      `,
      [
        body.caseId,
        body.travelerProfileId,
        body.tripPurpose,
        body.outboundDate,
        body.returnDate,
        body.outboundAirport,
        body.returnAirport,
        body.destinationCity ?? null,
        body.destinationAddress ?? null,
        body.hotelProximityPreference ?? null,
        body.minimumHotelStarRating ?? null,
        body.budgetFilter,
        body.companionTraveler ?? false,
        body.status ?? null,
        tripId,
        currentUser.companyId,
        currentUser.roleName,
        currentUser.id
      ]
    );

    if (result.rowCount === 0) {
      return jsonResponse(404, {
        message: "Trip not found or user is not authorized to update it."
      });
    }

    return jsonResponse(200, {
      id: result.rows[0].id,
      message: "Trip updated."
    });
  } catch (error) {
    console.error("PUT /trips/{id} error", error);

    return jsonResponse(500, {
      message: "Unable to update trip."
    });
  }
}