import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { getAuthorizedCase, isCaseTraveler } from "../common/tripAuthorization";
type TripBody = {
  caseId: string; travelerProfileId: string; ipcmUserId?: string;
  tripPurpose: string; outboundDate: string; returnDate: string;
  outboundAirport: string; returnAirport: string;
  returnDepartureAirport?: string | null; returnArrivalAirport?: string | null;
  destinationCity?: string; destinationAddress?: string;
  hotelProximityPreference?: string; minimumHotelStarRating?: number;
  budgetFilter: number; companionTraveler?: boolean;
  ipcmApprovalRequired?: boolean; status?: string;
};

function parseBody(event: APIGatewayProxyEvent): TripBody | null {
  let body: Partial<TripBody>;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return null; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  for (const key of ["caseId", "travelerProfileId", "tripPurpose", "outboundDate", "returnDate", "outboundAirport", "returnAirport"] as const) {
    if (typeof body[key] !== "string" || !body[key]?.trim()) return null;
  }
  for (const key of ["outboundAirport", "returnAirport"] as const) {
    const value = body[key];
    if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) return null;
    body[key] = value.trim().toUpperCase();
  }
  for (const key of ["returnDepartureAirport", "returnArrivalAirport"] as const) {
    const value = body[key];
    if (value === undefined || value === null || value === "") { body[key] = null; continue; }
    if (typeof value !== "string" || !/^[A-Za-z]{3}$/.test(value.trim())) return null;
    body[key] = value.trim().toUpperCase();
  }
  if (typeof body.budgetFilter !== "number" || !Number.isFinite(body.budgetFilter) || body.budgetFilter < 0) return null;
  if (body.minimumHotelStarRating != null && (!Number.isInteger(body.minimumHotelStarRating) || body.minimumHotelStarRating < 1 || body.minimumHotelStarRating > 5)) return null;
  if (body.returnDate! < body.outboundDate!) return null;
  return body as TripBody;
}
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const user = await getCurrentUser(event);
    if (!user) return jsonResponse(403, { message: "Authenticated user does not exist in Orvo database." });
    if (!["admin", "case_manager"].includes(user.roleName)) return jsonResponse(403, { message: "User role is not authorized to update trips." });
    const tripId = event.pathParameters?.id ?? event.pathParameters?.tripId;
    if (!tripId) return jsonResponse(400, { message: "Missing trip ID." });
    const body = parseBody(event);
    if (!body) return jsonResponse(400, { message: "Invalid or missing trip fields." });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{id: string; case_id: string}>(`
        SELECT t.id, t.case_id FROM trips t JOIN cases c ON c.id = t.case_id
        WHERE t.id = $1 AND c.company_id = $2
          AND ($3 = 'admin' OR c.case_manager_user_id = $4)
        FOR UPDATE OF t
      `, [tripId, user.companyId, user.roleName, user.id]);
      if (!existing.rows[0]) { await client.query("ROLLBACK"); return jsonResponse(404, { message: "Trip not found or user is not authorized to update it." }); }
      const selectedCase = await getAuthorizedCase(client, user, body.caseId);
      if (!selectedCase) { await client.query("ROLLBACK"); return jsonResponse(403, { message: "User is not authorized to use the selected case." }); }
      if (!(await isCaseTraveler(client, user.companyId, body.caseId, body.travelerProfileId))) {
        await client.query("ROLLBACK"); return jsonResponse(400, { message: "Traveler must be active and assigned to the selected case." });
      }
      const result = await client.query<{id: string; case_manager_user_id: string}>(`
        UPDATE trips SET case_id=$1, traveler_profile_id=$2, case_manager_user_id=$3,
          trip_purpose=$4, outbound_date=$5, return_date=$6, outbound_airport=$7,
          return_airport=$8, destination_city=$9, destination_address=$10,
          hotel_proximity_preference=$11, minimum_hotel_star_rating=$12,
          budget_filter=$13, companion_traveler=$14, ipcm_approval_required=$15,
          return_departure_airport=$16, return_arrival_airport=$17,
          updated_at=CURRENT_TIMESTAMP
        WHERE id=$18 RETURNING id, case_manager_user_id
      `, [body.caseId, body.travelerProfileId, selectedCase.case_manager_user_id,
        body.tripPurpose, body.outboundDate, body.returnDate, body.outboundAirport,
        body.returnAirport, body.destinationCity ?? null, body.destinationAddress ?? null,
        body.hotelProximityPreference ?? null, body.minimumHotelStarRating ?? null,
        body.budgetFilter, body.companionTraveler ?? false, body.ipcmApprovalRequired ?? false,
        body.returnDepartureAirport ?? null, body.returnArrivalAirport ?? null, tripId]);
      await client.query("COMMIT");
      return jsonResponse(200, { id: result.rows[0].id, ipcmUserId: result.rows[0].case_manager_user_id, message: "Trip updated." });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) { console.error("PUT /trips/{id} error", error); return jsonResponse(500, { message: "Unable to update trip." }); }
}
