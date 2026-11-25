import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/pool";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { validateTripParticipants, addTripTravelers } from "../common/tripAuthorization";
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
    const manager = await validateTripParticipants(client, user, body);
    const reference = `TRIP-${randomUUID().slice(0, 12).toUpperCase()}`;
    const created = await client.query<{ id: string }>(
      `INSERT INTO trips (
        trip_reference_id, company_id, traveler_profile_id, case_manager_user_id, trip_purpose, status,
        outbound_date, return_date, outbound_airport, return_airport, return_departure_airport,
        return_arrival_airport, destination_city, clinic_zip_code, hotel_proximity_preference,
        minimum_hotel_star_rating, budget_filter, companion_traveler, ipcm_approval_required, approving_case_manager_user_id
      ) VALUES ($1,$2,$3,$4,$5,'Created',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [reference, user.companyId, body.travelerProfileId, manager,
        body.tripPurpose, body.outboundDate, body.returnDate, body.outboundAirport, body.returnAirport,
        body.returnDepartureAirport, body.returnArrivalAirport, body.destinationCity, body.clinicZipCode,
        body.hotelProximityPreference, body.minimumHotelStarRating, body.budgetFilter,
        body.companionTraveler, body.ipcmApprovalRequired, body.approvingCaseManagerUserId]
    );
    await addTripTravelers(client, created.rows[0].id, body.travelerProfileIds);
    await client.query("COMMIT");
    return jsonResponse(201, { id: created.rows[0].id, tripReferenceId: reference });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("POST /trips error", error);
    return jsonResponse(400, { message: error instanceof Error ? error.message : "Unable to create trip." });
  } finally { client.release(); }
}
