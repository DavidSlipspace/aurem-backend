import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { getCaseFormOptions } from "../services/cases/caseService";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const user = await getCurrentUser(event);
    if (!user) return jsonResponse(403, { message: "Authenticated user does not exist in Orvo database." });
    if (user.roleName !== "admin" && user.roleName !== "case_manager") return jsonResponse(403, { message: "Only Administrators and Case Managers can manage case assignments." });
    const options = await getCaseFormOptions(user.companyId);
    return jsonResponse(200, user.roleName === "case_manager"
      ? { ...options, caseManagers: options.caseManagers.filter((manager) => manager.id === user.id) }
      : options);
  } catch (error) {
    console.error("GET /cases/options error", error);
    return jsonResponse(500, { message: "Unable to load case assignment options." });
  }
}
