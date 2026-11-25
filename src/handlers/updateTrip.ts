import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { validateTripParticipants, addTripTravelers } from "../common/tripAuthorization";
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
    const old = await client.query(`SELECT id, traveler_profile_id, status, approving_case_manager_user_id FROM trips WHERE id=$1 AND company_id=$2 AND ($3='admin' OR case_manager_user_id=$4) FOR UPDATE`, [tripId,user.companyId,user.roleName,user.id]);
    if (!old.rowCount) { await client.query("ROLLBACK"); return jsonResponse(403,{message:"Trip access denied."}); }
    if (old.rows[0].status !== "Created" && old.rows[0].approving_case_manager_user_id !== body.approvingCaseManagerUserId) throw new Error("Approval assignment cannot change after the trip leaves Created status.");
    const manager = await validateTripParticipants(client,user,body);
    const protectedRecords = await client.query(`SELECT 1 FROM booking_links WHERE trip_id=$1 UNION ALL SELECT 1 FROM traveler_booking_links WHERE trip_id=$1 UNION ALL SELECT 1 FROM trip_traveler_flights WHERE trip_id=$1 UNION ALL SELECT 1 FROM trip_hotel_reservations WHERE trip_id=$1 UNION ALL SELECT 1 FROM trip_flights WHERE trip_id=$1 UNION ALL SELECT 1 FROM trip_hotels WHERE trip_id=$1 UNION ALL SELECT 1 FROM trip_purchase_jobs WHERE trip_id=$1 LIMIT 1`,[tripId]);
    const existing = await client.query<{traveler_profile_id:string}>(`SELECT traveler_profile_id FROM trip_travelers WHERE trip_id=$1`,[tripId]);
    if (protectedRecords.rowCount && (old.rows[0].traveler_profile_id !== body.travelerProfileId || existing.rows.length !== body.travelerProfileIds.length || existing.rows.some(r=>!body.travelerProfileIds.includes(r.traveler_profile_id)))) throw new Error("Cannot change travelers after booking links or reservations exist.");
    await addTripTravelers(client,tripId,body.travelerProfileIds);
    await client.query(`DELETE FROM trip_travelers WHERE trip_id=$1 AND NOT (traveler_profile_id=ANY($2::uuid[]))`,[tripId,body.travelerProfileIds]);
    await client.query(
      `UPDATE trips SET company_id=$1, traveler_profile_id=$2, case_manager_user_id=$3,
        trip_purpose=$4, outbound_date=$5, return_date=$6, outbound_airport=$7, return_airport=$8,
        return_departure_airport=$9, return_arrival_airport=$10, destination_city=$11, clinic_zip_code=$12,
        hotel_proximity_preference=$13, minimum_hotel_star_rating=$14, budget_filter=$15,
        companion_traveler=$16, ipcm_approval_required=$17, approving_case_manager_user_id=$19,
        updated_at=CURRENT_TIMESTAMP WHERE id=$18`,
      [user.companyId, body.travelerProfileId, manager, body.tripPurpose,
        body.outboundDate, body.returnDate, body.outboundAirport, body.returnAirport,
        body.returnDepartureAirport, body.returnArrivalAirport, body.destinationCity, body.clinicZipCode,
        body.hotelProximityPreference, body.minimumHotelStarRating, body.budgetFilter,
        body.companionTraveler, body.ipcmApprovalRequired, tripId, body.approvingCaseManagerUserId]
    );
    await client.query("COMMIT");
    return jsonResponse(200, { id: tripId, message: "Trip updated." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("PUT /trips/{tripId} error", error);
    return jsonResponse(400, { message: error instanceof Error ? error.message : "Unable to update trip." });
  } finally { client.release(); }
}
