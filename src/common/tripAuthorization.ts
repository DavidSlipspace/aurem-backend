import type { PoolClient } from "pg";
import type { CurrentUser } from "./currentUser";
import type { ParsedTripBody } from "../handlers/tripBody";
export async function validateTripParticipants(client: PoolClient, user: CurrentUser, body: ParsedTripBody): Promise<string> {
  const manager = user.roleName === "admin" ? body.ipcmUserId : user.id;
  if (user.roleName !== "admin" && body.ipcmUserId && body.ipcmUserId !== user.id) throw new Error("Cannot assign another Case Manager.");
  const result = await client.query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.company_id=$2 AND u.status='active' AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name IN ('case_manager','ipcm')) FOR SHARE OF u`, [manager,user.companyId]);
  if (!result.rowCount) throw new Error("Select an active company Case Manager.");
  if (body.approvingCaseManagerUserId) {
    const approver = await client.query(`SELECT u.id FROM users u WHERE u.id=$1 AND u.company_id=$2 AND u.status='active' AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id AND r.name IN ('case_manager','ipcm')) FOR SHARE OF u`, [body.approvingCaseManagerUserId,user.companyId]);
    if (!approver.rowCount) throw new Error("Select an active company approving Case Manager.");
  }
  const travelers = await client.query(`SELECT id FROM traveler_profiles WHERE id=ANY($1::uuid[]) AND company_id=$2 AND status='active' FOR SHARE`, [body.travelerProfileIds,user.companyId]);
  if (travelers.rowCount !== body.travelerProfileIds.length) throw new Error("Select active company travelers.");
  return manager;
}
export async function addTripTravelers(client: PoolClient, tripId: string, ids: string[]) {
  await client.query(`INSERT INTO trip_travelers(trip_id,traveler_profile_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [tripId,ids]);
}
