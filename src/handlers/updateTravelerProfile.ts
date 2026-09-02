import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";
import { assertAdminOrCaseManager, getCurrentUser } from "../common/currentUser";

type UpdateTravelerProfileRequest = {
  legalFirstName: string;
  legalMiddleName?: string;
  legalLastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  tsaPrecheckNumber?: string;
  frequentFlyerProgram?: string;
  frequentFlyerNumber?: string;
  hotelRewardsProgram?: string;
  hotelRewardsNumber?: string;
  seatPreference?: string;
  status?: string;
};

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const currentUser = await getCurrentUser(event);

    if (!currentUser) {
      return jsonResponse(403, { message: "Authenticated user does not exist in Aurem database." });
    }

    try {
      assertAdminOrCaseManager(currentUser);
    } catch {
      return jsonResponse(403, { message: "User role is not authorized to update GC profiles." });
    }

    const travelerProfileId = event.pathParameters?.id;

    if (!travelerProfileId) {
      return jsonResponse(400, { message: "Missing GC profile ID." });
    }

    const body = JSON.parse(event.body ?? "{}") as UpdateTravelerProfileRequest;

    if (!body.legalFirstName || !body.legalLastName || !body.dateOfBirth || !body.email || !body.phone) {
      return jsonResponse(400, { message: "Missing required fields." });
    }

    const pool = getPool();

    const result = await pool.query(
      `
      UPDATE traveler_profiles
      SET
        legal_first_name = $1,
        legal_middle_name = $2,
        legal_last_name = $3,
        date_of_birth = $4,
        email = $5,
        phone = $6,
        tsa_precheck_number = $7,
        frequent_flyer_program = $8,
        frequent_flyer_number = $9,
        hotel_rewards_program = $10,
        hotel_rewards_number = $11,
        seat_preference = $12,
        status = COALESCE($13, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
        AND company_id = $15
      RETURNING id;
      `,
      [
        body.legalFirstName,
        body.legalMiddleName ?? null,
        body.legalLastName,
        body.dateOfBirth,
        body.email,
        body.phone,
        body.tsaPrecheckNumber ?? null,
        body.frequentFlyerProgram ?? null,
        body.frequentFlyerNumber ?? null,
        body.hotelRewardsProgram ?? null,
        body.hotelRewardsNumber ?? null,
        body.seatPreference ?? null,
        body.status ?? null,
        travelerProfileId,
        currentUser.companyId
      ]
    );

    if (result.rowCount === 0) {
      return jsonResponse(404, { message: "GC profile not found." });
    }

    return jsonResponse(200, {
      id: result.rows[0].id,
      message: "GC profile updated."
    });
  } catch (error) {
    console.error("PUT /traveler-profiles/{id} error", error);
    return jsonResponse(500, { message: "Unable to update GC profile." });
  }
}