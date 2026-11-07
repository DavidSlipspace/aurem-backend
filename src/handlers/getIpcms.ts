import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { getCompanyIpcmDirectory } from "../services/ipcm/ipcmInvitationService";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const user = await getCurrentUser(event);
    if (!user) return jsonResponse(403, { message: "Authenticated user does not exist in the Orvo database." });
    if (!["admin", "case_manager"].includes(user.roleName)) return jsonResponse(403, { message: "Your role is not authorized to view Case Manager profiles." });
    return jsonResponse(200, { canInvite: user.roleName === "admin", ipcms: await getCompanyIpcmDirectory(user.companyId) });
  } catch (error) { console.error("GET /ipcms failed", error); return jsonResponse(500, { message: "Unable to load Case Manager profiles." }); }
}
