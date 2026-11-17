import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/pool";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { rebalanceCaseTripBudgets } from "./tripBudget";
import { parseTripBody } from "./tripBody";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = await getCurrentUser(event);
  if (!user || !["admin", "case_manager"].includes(user.roleName)) {
    return jsonResponse(403, { message: "Not authorized to create trips." });
  }
  let body;
  try { body = parseTripBody(event.body); }
  catch (error) { return jsonResponse(400, { message: (error as Error).message }); }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Case row lock serializes all trip creations/edits and budget rebalances for this case.
    const selected = await client.query<{ case_manager_user_id: string }>(
      `SELECT case_manager_user_id FROM cases WHERE id = $1 AND company_id = $2
       AND ($3 = 'admin' OR case_manager_user_id = $4) FOR UPDATE`,
      [body.caseId, user.companyId, user.roleName, user.id]
    );
    if (!selected.rowCount) { await client.query("ROLLBACK"); return jsonResponse(403, { message: "Case is not assigned to you or does not exist." }); }
    const traveler = await client.query(
      `SELECT 1 FROM case_travelers ct JOIN traveler_profiles tp ON tp.id = ct.traveler_profile_id
       WHERE ct.case_id = $1 AND ct.traveler_profile_id = $2 AND tp.company_id = $3 AND tp.status = 'active'`,
      [body.caseId, body.travelerProfileId, user.companyId]
    );
    if (!traveler.rowCount) { await client.query("ROLLBACK"); return jsonResponse(400, { message: "Traveler is not active and assigned to this case." }); }
    const reference = `TRIP-${randomUUID().slice(0, 12).toUpperCase()}`;
    const created = await client.query<{ id: string }>(
      `INSERT INTO trips (
        trip_reference_id, case_id, traveler_profile_id, case_manager_user_id, trip_purpose, status,
        outbound_date, return_date, outbound_airport, return_airport, return_departure_airport,
        return_arrival_airport, destination_city, clinic_zip_code, hotel_proximity_preference,
        minimum_hotel_star_rating, budget_filter, budget_is_manual, companion_traveler, ipcm_approval_required
      ) VALUES ($1,$2,$3,$4,$5,'Created',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [reference, body.caseId, body.travelerProfileId, selected.rows[0].case_manager_user_id,
        body.tripPurpose, body.outboundDate, body.returnDate, body.outboundAirport, body.returnAirport,
        body.returnDepartureAirport, body.returnArrivalAirport, body.destinationCity, body.clinicZipCode,
        body.hotelProximityPreference, body.minimumHotelStarRating, body.budgetFilter,
        body.budgetIsManual, body.companionTraveler, body.ipcmApprovalRequired]
    );
    await rebalanceCaseTripBudgets(client, body.caseId);
    await client.query("COMMIT");
    return jsonResponse(201, { id: created.rows[0].id, tripReferenceId: reference });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /trips error", error);
    return jsonResponse(400, { message: error instanceof Error ? error.message : "Unable to create trip." });
  } finally { client.release(); }
}
