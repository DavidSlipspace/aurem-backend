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
  updateAssignedIpcmBudget
} from "../services/cases/caseService";

type BudgetBody = {
  approvedBudgetCents?:
    unknown;
};

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
      "ipcm"
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Only the assigned IPCM can set the approved case budget."
        }
      );
    }

    const caseId =
      event.pathParameters
        ?.id
        ?.trim();

    if (!caseId) {
      return jsonResponse(
        400,
        {
          message:
            "Case ID is required."
        }
      );
    }

    let body:
      BudgetBody;

    try {
      body =
        JSON.parse(
          event.body ??
            "{}"
        ) as
          BudgetBody;
    } catch {
      return jsonResponse(
        400,
        {
          message:
            "Invalid request body."
        }
      );
    }

    const approvedBudgetCents =
      body
        .approvedBudgetCents;

    if (
      typeof approvedBudgetCents !==
        "number" ||
      !Number.isInteger(
        approvedBudgetCents
      ) ||
      approvedBudgetCents <
        0
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Approved budget must be a non-negative whole number of cents."
        }
      );
    }

    await updateAssignedIpcmBudget(
      currentUser
        .companyId,
      currentUser.id,
      caseId,
      approvedBudgetCents
    );

    return jsonResponse(
      200,
      {
        id:
          caseId,

        approvedBudgetCents,

        message:
          "Case budget updated successfully."
      }
    );
  } catch (
    error
  ) {
    if (
      error instanceof
      CaseServiceError &&
      error.code ===
        "NOT_FOUND"
    ) {
      return jsonResponse(
        404,
        {
          message:
            error.message
        }
      );
    }

    console.error(
      "PUT /cases/{id}/budget error",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to update case budget."
      }
    );
  }
}