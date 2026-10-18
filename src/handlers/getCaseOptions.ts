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
  getCaseFormOptions
} from "../services/cases/caseService";

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
            "Only Administrators can manage case assignments."
        }
      );
    }

    const options =
      await getCaseFormOptions(
        currentUser
          .companyId
      );

    return jsonResponse(
      200,
      options
    );
  } catch (
    error
  ) {
    console.error(
      "GET /cases/options error",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to load case assignment options."
      }
    );
  }
}