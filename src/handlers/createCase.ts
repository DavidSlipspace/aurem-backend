import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";
import { CaseServiceError, createCaseRecord, type CaseMutationInput } from "../services/cases/caseService";
import { sendTransactionalEmail } from "../services/email/emailService";
import { buildCaseAssignmentEmail } from "../services/email/emailTemplates";

type CreateCaseBody = {
  caseReferenceId?: unknown;
  caseManagerUserId?: unknown;
  travelerProfileIds?: unknown;
  suggestedBudgetCents?: unknown;
  status?: unknown;
};

function parseBody(event: APIGatewayProxyEvent, assignedManagerId?: string): CaseMutationInput {
  let body: CreateCaseBody;
  try {
    body = JSON.parse(event.body ?? "{}") as CreateCaseBody;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
  } catch {
    throw new Error("INVALID_JSON");
  }
  const caseReferenceId = typeof body.caseReferenceId === "string" ? body.caseReferenceId.trim() : "";
  const submittedManagerId = typeof body.caseManagerUserId === "string" ? body.caseManagerUserId.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (assignedManagerId && submittedManagerId && submittedManagerId !== assignedManagerId) throw new Error("FORBIDDEN_ASSIGNMENT");
  const ipcmUserId = assignedManagerId ?? submittedManagerId;
  if (!caseReferenceId || caseReferenceId.length > 50 || !ipcmUserId || !status) throw new Error("INVALID_FIELDS");
  if (!Array.isArray(body.travelerProfileIds) || body.travelerProfileIds.some((item) => typeof item !== "string")) throw new Error("INVALID_TRAVELERS");
  const travelerProfileIds = [...new Set((body.travelerProfileIds as string[]).map((id) => id.trim()).filter(Boolean))];
  if (!travelerProfileIds.length) throw new Error("INVALID_TRAVELERS");
  const budget = body.suggestedBudgetCents;
  if (budget !== undefined && budget !== null && budget !== "" && (typeof budget !== "number" || !Number.isInteger(budget) || budget < 0)) throw new Error("INVALID_BUDGET");
  return { caseReferenceId, ipcmUserId, travelerProfileIds, suggestedBudgetCents: typeof budget === "number" ? budget : null, status };
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const user = await getCurrentUser(event);
    if (!user) return jsonResponse(403, { message: "Authenticated user does not exist in Orvo database." });
    if (user.roleName !== "admin" && user.roleName !== "case_manager") return jsonResponse(403, { message: "Only Administrators and Case Managers can create cases." });
    let input: CaseMutationInput;
    try {
      input = parseBody(event, user.roleName === "case_manager" ? user.id : undefined);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "FORBIDDEN_ASSIGNMENT") return jsonResponse(403, { message: "Case Managers can only assign cases to themselves." });
      const messages: Record<string, string> = {
        INVALID_JSON: "Invalid request body.",
        INVALID_BUDGET: "Suggested budget must be a non-negative whole number of cents.",
        INVALID_TRAVELERS: "At least one traveler must be assigned to the case.",
        INVALID_FIELDS: "Case reference, Case Manager, travelers, and status are required."
      };
      return jsonResponse(400, { message: messages[code] ?? messages.INVALID_FIELDS });
    }
    const result = await createCaseRecord(user.companyId, input);
    let emailWarning: string | undefined;
    const frontendBaseUrl = process.env.FRONTEND_BASE_URL;
    if (!frontendBaseUrl) {
      console.error("FRONTEND_BASE_URL is not configured.");
      emailWarning = "The case was created, but the Case Manager assignment email could not be sent.";
    } else {
      try {
        await sendTransactionalEmail(buildCaseAssignmentEmail({
          recipientEmail: result.ipcmEmail,
          recipientFirstName: result.ipcmFirstName,
          caseReferenceId: result.caseReferenceId,
          suggestedBudgetCents: input.suggestedBudgetCents,
          frontendBaseUrl
        }));
      } catch (error) {
        console.error("Unable to send Case Manager assignment email", error);
        emailWarning = "The case was created, but the Case Manager assignment email could not be sent.";
      }
    }
    return jsonResponse(201, { id: result.id, caseReferenceId: result.caseReferenceId, message: "Case created successfully.", ...(emailWarning ? { emailWarning } : {}) });
  } catch (error) {
    if (error instanceof CaseServiceError) {
      if (error.code === "DUPLICATE_REFERENCE") return jsonResponse(409, { message: error.message });
      if (error.code === "INVALID_ASSIGNEE" || error.code === "INVALID_TRAVELER") return jsonResponse(400, { message: error.message });
    }
    console.error("POST /cases error", error);
    return jsonResponse(500, { message: "Unable to create case." });
  }
}
