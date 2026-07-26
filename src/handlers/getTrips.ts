import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";
import { getCurrentUser } from "../common/currentUser";

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

  destination_city: string | null;
  destination_address: string | null;
  hotel_proximity_preference: string | null;
  minimum_hotel_star_rating: number | null;

  budget_filter: number;
  companion_traveler: boolean;
  ipcm_approval_required: boolean;
};

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const currentUser = await getCurrentUser(event);

    if (!currentUser) {
      return jsonResponse(403, {
        message:
          "Authenticated user does not exist in Aurem database."
      });
    }

    let whereClause = "";
    const params: string[] = [];

    if (currentUser.roleName === "admin") {
      whereClause = "cm.company_id = $1";
      params.push(currentUser.companyId);
    } else if (
      currentUser.roleName === "case_manager"
    ) {
      whereClause = "c.case_manager_user_id = $1";
      params.push(currentUser.id);
    } else if (currentUser.roleName === "ipcm") {
      whereClause = "c.ip_user_id = $1";
      params.push(currentUser.id);
    } else {
      return jsonResponse(403, {
        message:
          "User role is not authorized to view trips."
      });
    }

    const pool = getPool();

    const result = await pool.query<TripRow>(
      `
        SELECT
          t.id,
          t.trip_reference_id,

          t.case_id,
          c.case_reference_id,

          t.gc_profile_id,
          gp.legal_first_name AS gc_first_name,
          gp.legal_last_name AS gc_last_name,
          gp.email AS gc_email,

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
          t.ipcm_approval_required

        FROM trips t

        JOIN cases c
          ON c.id = t.case_id

        JOIN users cm
          ON cm.id = c.case_manager_user_id

        JOIN gc_profiles gp
          ON gp.id = t.gc_profile_id

        WHERE ${whereClause}

        ORDER BY t.created_at DESC;
      `,
      params
    );

    return jsonResponse(200, {
      trips: result.rows.map((row) => ({
        id: row.id,
        tripReferenceId:
          row.trip_reference_id,

        caseId: row.case_id,
        caseReferenceId:
          row.case_reference_id,

        gcProfileId: row.gc_profile_id,
        gcName:
          `${row.gc_first_name} ${row.gc_last_name}`.trim(),
        gcEmail: row.gc_email,

        tripPurpose: row.trip_purpose,
        status: row.status,

        outboundDate: row.outbound_date,
        returnDate: row.return_date,
        outboundAirport:
          row.outbound_airport,
        returnAirport:
          row.return_airport,

        destinationCity:
          row.destination_city,
        destinationAddress:
          row.destination_address,

        hotelProximityPreference:
          row.hotel_proximity_preference,

        minimumHotelStarRating:
          row.minimum_hotel_star_rating,

        budgetFilter: Number(
          row.budget_filter
        ),

        companionTraveler:
          row.companion_traveler,

        ipcmApprovalRequired:
          row.ipcm_approval_required
      }))
    });
  } catch (error) {
    console.error("GET /trips error", error);

    return jsonResponse(500, {
      message: "Unable to load trips."
    });
  }
}