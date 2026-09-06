import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  getCurrentUser
} from "../common/currentUser";

import {
  jsonResponse
} from "../common/response";

import {
  CaseServiceError,
  createCaseRecord,
  type CaseMutationInput
} from "../services/cases/caseService";

import {
  sendTransactionalEmail
} from "../services/email/emailService";

import {
  buildCaseAssignmentEmail
} from "../services/email/emailTemplates";

type CreateCaseBody = {
  caseReferenceId?:
    unknown;

  caseManagerUserId?:
    unknown;

  ipcmUserId?:
    unknown;

  suggestedBudgetCents?:
    unknown;

  status?:
    unknown;
};

function parseOptionalBudget(
  value: unknown
):
  | number
  | null {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ""
  ) {
    return null;
  }

  if (
    typeof value !==
      "number" ||
    !Number.isInteger(
      value
    ) ||
    value < 0
  ) {
    throw new Error(
      "INVALID_BUDGET"
    );
  }

  return value;
}

function parseBody(
  event:
    APIGatewayProxyEvent
): CaseMutationInput {
  let body:
    CreateCaseBody;

  try {
    body =
      JSON.parse(
        event.body ??
          "{}"
      ) as
        CreateCaseBody;
  } catch {
    throw new Error(
      "INVALID_JSON"
    );
  }

  const caseReferenceId =
    typeof body
      .caseReferenceId ===
      "string"
      ? body
          .caseReferenceId
          .trim()
      : "";

  const caseManagerUserId =
    typeof body
      .caseManagerUserId ===
      "string"
      ? body
          .caseManagerUserId
          .trim()
      : "";

  const ipcmUserId =
    typeof body
      .ipcmUserId ===
      "string"
      ? body
          .ipcmUserId
          .trim()
      : "";

  const status =
    typeof body.status ===
      "string"
      ? body.status
          .trim()
      : "";

  if (
    !caseReferenceId ||
    caseReferenceId.length >
      50 ||
    !caseManagerUserId ||
    !ipcmUserId ||
    !status
  ) {
    throw new Error(
      "INVALID_FIELDS"
    );
  }

  return {
    caseReferenceId,

    caseManagerUserId,

    ipcmUserId,

    suggestedBudgetCents:
      parseOptionalBudget(
        body
          .suggestedBudgetCents
      ),

    status
  };
}

export async function handler(
  event:
    APIGatewayProxyEvent
): Promise<
  APIGatewayProxyResult
> {
  try {
    const currentUser =
      await getCurrentUser(
        event
      );

    if (
      !currentUser
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Authenticated user does not exist in Aurem database."
        }
      );
    }

    if (
      currentUser
        .roleName !==
      "admin"
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Only Administrators can create cases."
        }
      );
    }

    let input:
      CaseMutationInput;

    try {
      input =
        parseBody(
          event
        );
    } catch (
      error
    ) {
      const code =
        error instanceof Error
          ? error.message
          : "";

      if (
        code ===
        "INVALID_JSON"
      ) {
        return jsonResponse(
          400,
          {
            message:
              "Invalid request body."
          }
        );
      }

      if (
        code ===
        "INVALID_BUDGET"
      ) {
        return jsonResponse(
          400,
          {
            message:
              "Suggested budget must be a non-negative whole number of cents."
          }
        );
      }

      return jsonResponse(
        400,
        {
          message:
            "Case reference, Case Manager, IPCM, and status are required."
        }
      );
    }

    const result =
      await createCaseRecord(
        currentUser
          .companyId,
        input
      );

    let emailWarning:
      string |
      undefined;

    const frontendBaseUrl =
      process.env
        .FRONTEND_BASE_URL;

    if (
      !frontendBaseUrl
    ) {
      console.error(
        "FRONTEND_BASE_URL is not configured."
      );

      emailWarning =
        "The case was created, but the assignment email could not be sent.";
    } else {
      try {
        await sendTransactionalEmail(
          buildCaseAssignmentEmail({
            recipientEmail:
              result
                .ipcmEmail,

            recipientFirstName:
              result
                .ipcmFirstName,

            caseReferenceId:
              result
                .caseReferenceId,

            suggestedBudgetCents:
              input
                .suggestedBudgetCents,

            frontendBaseUrl
          })
        );
      } catch (
        emailError
      ) {
        console.error(
          "Unable to send case assignment email",
          emailError
        );

        emailWarning =
          "The case was created, but the IPCM assignment email could not be sent.";
      }
    }

    return jsonResponse(
      201,
      {
        id:
          result.id,

        caseReferenceId:
          result
            .caseReferenceId,

        message:
          "Case created successfully.",

        ...(emailWarning
          ? {
              emailWarning
            }
          : {})
      }
    );
  } catch (
    error
  ) {
    if (
      error instanceof
      CaseServiceError
    ) {
      if (
        error.code ===
        "DUPLICATE_REFERENCE"
      ) {
        return jsonResponse(
          409,
          {
            message:
              error.message
          }
        );
      }

      if (
        error.code ===
        "INVALID_ASSIGNEE"
      ) {
        return jsonResponse(
          400,
          {
            message:
              error.message
          }
        );
      }
    }

    console.error(
      "POST /cases error",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to create case."
      }
    );
  }
}