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
  getCompanyIpcmPaymentProfiles,
  getSelfIpcmPaymentProfile
} from "../services/payments/paymentMethodService";

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const currentUser =
      await getCurrentUser(
        event
      );

    if (!currentUser) {
      return jsonResponse(
        403,
        {
          message:
            "Authenticated user does not exist in the Aurem database."
        }
      );
    }

    if (
      !currentUser.companyId
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Your user account is not associated with an Aurem company."
        }
      );
    }

    if (
      currentUser.roleName ===
      "admin"
    ) {
      const ipcms =
        await getCompanyIpcmPaymentProfiles(
          currentUser.companyId
        );

      return jsonResponse(
        200,
        {
          mode:
            "admin",

          ipcms
        }
      );
    }

    if (
      currentUser.roleName ===
      "ipcm"
    ) {
      const profile =
        await getSelfIpcmPaymentProfile(
          currentUser.id,
          currentUser.companyId
        );

      if (!profile) {
        return jsonResponse(
          404,
          {
            message:
              "Your IPCM payment profile could not be found."
          }
        );
      }

      return jsonResponse(
        200,
        {
          mode:
            "self",

          ipcms: [
            profile
          ]
        }
      );
    }

    return jsonResponse(
      403,
      {
        message:
          "Your role is not authorized to manage payment methods."
      }
    );
  } catch (error) {
    console.error(
      "GET /payment-methods failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to load payment methods."
      }
    );
  }
}