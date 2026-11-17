import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { rebalanceCaseTripBudgets } from "./tripBudget";
import { parseTripBody } from "./tripBody";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const user = await getCurrentUser(event);
  if (!user || !["admin", "case_manager"].includes(user.roleName)) return jsonResponse(403, { message: "Not authorized to edit trips." });
  const tripId = event.pathParameters?.tripId;
  if (!tripId) return jsonResponse(400, { message: "Trip ID is required." });
  let body;
  try { body = parseTripBody(event.body); }
  catch (error) { return jsonResponse(400, { message: (error as Error).message }); }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const old = await client.query<{ case_id: string }>(
      `SELECT t.case_id FROM trips t JOIN cases c ON c.id = t.case_id
       WHERE t.id = $1 AND c.company_id = $2 AND ($3 = 'admin' OR c.case_manager_user_id = $4)`,
      [tripId, user.companyId, user.roleName, user.id]
    );
    if (!old.rowCount) { await client.query("ROLLBACK"); return jsonResponse(403, { message: "Trip is not assigned to you or does not exist." }); }
    const oldCaseId = old.rows[0].case_id;
    // Stable lock order prevents deadlocks when trips move between cases.
    const ids = [...new Set([oldCaseId, body.caseId])].sort();
    const cases = await client.query<{ id: string; case_manager_user_id: string }>(
      `SELECT id, case_manager_user_id FROM cases WHERE id = ANY($1::uuid[]) AND company_id = $2 ORDER BY id FOR UPDATE`,
      [ids, user.companyId]
    );
    const target = cases.rows.find((row) => row.id === body.caseId);
    const original = cases.rows.find((row) => row.id === oldCaseId);
    if (!target || !original || (user.roleName !== "admin" &&
      (target.case_manager_user_id !== user.id || original.case_manager_user_id !== user.id))) {
      await client.query("ROLLBACK"); return jsonResponse(403, { message: "Case access denied." });
    }
    const locked = await client.query(`SELECT id FROM trips WHERE id = $1 AND case_id = $2 FOR UPDATE`, [tripId, oldCaseId]);
    if (!locked.rowCount) { await client.query("ROLLBACK"); return jsonResponse(409, { message: "Trip was changed. Reload and try again." }); }
    const traveler = await client.query(
      `SELECT 1 FROM case_travelers ct JOIN traveler_profiles tp ON tp.id = ct.traveler_profile_id
       WHERE ct.case_id = $1 AND ct.traveler_profile_id = $2 AND tp.company_id = $3 AND tp.status = 'active'`,
      [body.caseId, body.travelerProfileId, user.companyId]
    );
    if (!traveler.rowCount) { await client.query("ROLLBACK"); return jsonResponse(400, { message: "Traveler is not active and assigned to this case." }); }
    await client.query(
      `UPDATE trips SET case_id=$1, traveler_profile_id=$2, case_manager_user_id=$3,
        trip_purpose=$4, outbound_date=$5, return_date=$6, outbound_airport=$7, return_airport=$8,
        return_departure_airport=$9, return_arrival_airport=$10, destination_city=$11, clinic_zip_code=$12,
        hotel_proximity_preference=$13, minimum_hotel_star_rating=$14, budget_filter=$15,
        budget_is_manual=$16, companion_traveler=$17, ipcm_approval_required=$18,
        updated_at=CURRENT_TIMESTAMP WHERE id=$19`,
      [body.caseId, body.travelerProfileId, target.case_manager_user_id, body.tripPurpose,
        body.outboundDate, body.returnDate, body.outboundAirport, body.returnAirport,
        body.returnDepartureAirport, body.returnArrivalAirport, body.destinationCity, body.clinicZipCode,
        body.hotelProximityPreference, body.minimumHotelStarRating, body.budgetFilter,
        body.budgetIsManual, body.companionTraveler, body.ipcmApprovalRequired, tripId]
    );
    await rebalanceCaseTripBudgets(client, oldCaseId);
    if (oldCaseId !== body.caseId) await rebalanceCaseTripBudgets(client, body.caseId);
    await client.query("COMMIT");
    return jsonResponse(200, { id: tripId, message: "Trip updated." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("PUT /trips/{tripId} error", error);
    return jsonResponse(400, { message: error instanceof Error ? error.message : "Unable to update trip." });
  } finally { client.release(); }
}
