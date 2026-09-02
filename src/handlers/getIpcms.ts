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
  getCompanyIpcmDirectory
} from "../services/ipcm/ipcmInvitationService";

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
            "Authenticated user does not exist in the Aurem database."
        }
      );
    }

    if (
      currentUser.roleName !==
      "admin"
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Only Administrators can view IPCM administration."
        }
      );
    }

    const ipcms =
      await getCompanyIpcmDirectory(
        currentUser.companyId
      );

    return jsonResponse(
      200,
      {
        canInvite:
          true,

        ipcms
      }
    );
  } catch (
    error
  ) {
    console.error(
      "GET /ipcms failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to load IPCM profiles."
      }
    );
  }
}