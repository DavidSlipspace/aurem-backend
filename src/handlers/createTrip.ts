import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { getAuthorizedCase, isCaseTraveler } from "../common/tripAuthorization";
import { randomUUID } from "node:crypto";
type TripBody = {
  caseId: string; travelerProfileId: string; ipcmUserId?: string;
  tripPurpose: string; outboundDate: string; returnDate: string;
  outboundAirport: string; returnAirport: string;
  destinationCity?: string; destinationAddress?: string;
  hotelProximityPreference?: string; minimumHotelStarRating?: number;
  budgetFilter: number; companionTraveler?: boolean;
  ipcmApprovalRequired?: boolean; status?: string;
};

function parseBody(event: APIGatewayProxyEvent): TripBody | null {
  let body: Partial<TripBody>;
  try { body = JSON.parse(event.body ?? "{}"); } catch { return null; }
  if (!body || typeof body !== "object") return null;
  for (const key of ["caseId", "travelerProfileId", "tripPurpose", "outboundDate", "returnDate", "outboundAirport", "returnAirport"] as const) {
    if (typeof body[key] !== "string" || !body[key]?.trim()) return null;
  }
  if (typeof body.budgetFilter !== "number" || !Number.isFinite(body.budgetFilter) || body.budgetFilter < 0) return null;
  if (body.minimumHotelStarRating != null && (!Number.isInteger(body.minimumHotelStarRating) || body.minimumHotelStarRating < 1 || body.minimumHotelStarRating > 5)) return null;
  if (body.returnDate! < body.outboundDate!) return null;
  return body as TripBody;
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const user = await getCurrentUser(event);
    if (!user) return jsonResponse(403, { message: "Authenticated user does not exist in Aurem database." });
    if (!["admin", "case_manager"].includes(user.roleName)) return jsonResponse(403, { message: "User role is not authorized to create trips." });
    const body = parseBody(event);
    if (!body) return jsonResponse(400, { message: "Invalid or missing trip fields." });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const selectedCase = await getAuthorizedCase(client, user, body.caseId);
      if (!selectedCase) { await client.query("ROLLBACK"); return jsonResponse(403, { message: "User is not authorized to create a trip for this case." }); }
      if (!(await isCaseTraveler(client, user.companyId, body.caseId, body.travelerProfileId))) {
        await client.query("ROLLBACK");
        return jsonResponse(400, { message: "Traveler must be active and assigned to the selected case." });
      }
      const tripReferenceId = `TRIP-${new Date().getUTCFullYear()}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const result = await client.query<{id: string; trip_reference_id: string}>(`
        INSERT INTO trips (
          trip_reference_id, case_id, traveler_profile_id, case_manager_user_id,
          trip_purpose, status, outbound_date, return_date, outbound_airport,
          return_airport, destination_city, destination_address,
          hotel_proximity_preference, minimum_hotel_star_rating, budget_filter,
          companion_traveler, ipcm_approval_required
        ) VALUES ($1,$2,$3,$4,$5,'Created',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        RETURNING id, trip_reference_id
      `, [tripReferenceId, body.caseId, body.travelerProfileId, selectedCase.case_manager_user_id,
        body.tripPurpose, body.outboundDate, body.returnDate, body.outboundAirport,
        body.returnAirport, body.destinationCity ?? null, body.destinationAddress ?? null,
        body.hotelProximityPreference ?? null, body.minimumHotelStarRating ?? null,
        body.budgetFilter, body.companionTraveler ?? false, body.ipcmApprovalRequired ?? false]);
      await client.query("COMMIT");
      return jsonResponse(201, { id: result.rows[0].id, tripReferenceId: result.rows[0].trip_reference_id, message: "Trip created." });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error) { console.error("POST /trips error", error); return jsonResponse(500, { message: "Unable to create trip." }); }
}
