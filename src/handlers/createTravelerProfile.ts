import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";
import { assertAdminOrCaseManager, getCurrentUser } from "../common/currentUser";

type CreateTravelerProfileRequest = {
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
      return jsonResponse(403, { message: "User role is not authorized to create GC profiles." });
    }

    const body = JSON.parse(event.body ?? "{}") as CreateTravelerProfileRequest;

    if (!body.legalFirstName || !body.legalLastName || !body.dateOfBirth || !body.email || !body.phone) {
      return jsonResponse(400, {
        message: "Missing required fields."
      });
    }

    const pool = getPool();

    const result = await pool.query(
      `
      INSERT INTO traveler_profiles (
        company_id,
        legal_first_name,
        legal_middle_name,
        legal_last_name,
        date_of_birth,
        email,
        phone,
        tsa_precheck_number,
        frequent_flyer_program,
        frequent_flyer_number,
        hotel_rewards_program,
        hotel_rewards_number,
        seat_preference
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id;
      `,
      [
        currentUser.companyId,
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
        body.seatPreference ?? null
      ]
    );

    return jsonResponse(201, {
      id: result.rows[0].id,
      message: "GC profile created."
    });
  } catch (error) {
    console.error("POST /traveler-profiles error", error);
    return jsonResponse(500, { message: "Unable to create GC profile." });
  }
}