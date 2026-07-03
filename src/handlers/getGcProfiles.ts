import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPool } from "../db/pool";
import { jsonResponse } from "../common/response";
import { assertAdminOrCaseManager, getCurrentUser } from "../common/currentUser";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const currentUser = await getCurrentUser(event);

    if (!currentUser) {
      return jsonResponse(403, { message: "Authenticated user does not exist in Aurem database." });
    }

    try {
      assertAdminOrCaseManager(currentUser);
    } catch {
      return jsonResponse(403, { message: "User role is not authorized to view GC profiles." });
    }

    const pool = getPool();

    const result = await pool.query(
      `
      SELECT
        id,
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
        seat_preference,
        status
      FROM gc_profiles
      WHERE company_id = $1
      ORDER BY legal_last_name, legal_first_name;
      `,
      [currentUser.companyId]
    );

    return jsonResponse(200, {
      gcProfiles: result.rows.map((row) => ({
        id: row.id,
        legalFirstName: row.legal_first_name,
        legalMiddleName: row.legal_middle_name,
        legalLastName: row.legal_last_name,
        dateOfBirth: row.date_of_birth,
        email: row.email,
        phone: row.phone,
        tsaPrecheckNumber: row.tsa_precheck_number,
        frequentFlyerProgram: row.frequent_flyer_program,
        frequentFlyerNumber: row.frequent_flyer_number,
        hotelRewardsProgram: row.hotel_rewards_program,
        hotelRewardsNumber: row.hotel_rewards_number,
        seatPreference: row.seat_preference,
        status: row.status
      }))
    });
  } catch (error) {
    console.error("GET /gc-profiles error", error);
    return jsonResponse(500, { message: "Unable to load GC profiles." });
  }
}