import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  CognitoIdentityProviderClient
} from "@aws-sdk/client-cognito-identity-provider";

import {
  getCurrentUser
} from "../common/currentUser";

import {
  jsonResponse
} from "../common/response";

import {
  revokeCompanyIpcmInvitation
} from "../services/ipcm/ipcmInvitationService";

import {
  deactivateIpcmUser,
  getIpcmRemovalCandidate
} from "../services/ipcm/ipcmAdministrationService";

const cognitoClient =
  new CognitoIdentityProviderClient(
    {}
  );

export async function handler(
  event:
    APIGatewayProxyEvent
): Promise<
  APIGatewayProxyResult
> {
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
          "Only Administrators can remove IPCMs."
      }
    );
  }

  const id =
    event.pathParameters
      ?.id
      ?.trim();

  const resourceType =
    event.queryStringParameters
      ?.resourceType
      ?.trim();

  if (!id) {
    return jsonResponse(
      400,
      {
        message:
          "IPCM ID is required."
      }
    );
  }

  if (
    resourceType !==
      "user" &&
    resourceType !==
      "invitation"
  ) {
    return jsonResponse(
      400,
      {
        message:
          "A valid IPCM resource type is required."
      }
    );
  }

  try {
    if (
      resourceType ===
      "invitation"
    ) {
      const revoked =
        await revokeCompanyIpcmInvitation(
          currentUser.companyId,
          id
        );

      if (!revoked) {
        return jsonResponse(
          404,
          {
            message:
              "The IPCM invitation could not be found or has already been removed."
          }
        );
      }

      return jsonResponse(
        200,
        {
          message:
            "IPCM invitation removed."
        }
      );
    }

    const candidate =
      await getIpcmRemovalCandidate(
        currentUser.companyId,
        id
      );

    if (!candidate) {
      return jsonResponse(
        404,
        {
          message:
            "The IPCM profile could not be found."
        }
      );
    }

    if (
      candidate.caseCount >
        0 ||
      candidate.tripCount >
        0
    ) {
      const caseText =
        candidate.caseCount ===
        1
          ? "1 case"
          : `${candidate.caseCount} cases`;

      const tripText =
        candidate.tripCount ===
        1
          ? "1 trip"
          : `${candidate.tripCount} trips`;

      return jsonResponse(
        409,
        {
          message:
            `This IPCM cannot be removed because they are still assigned to ${caseText} and ${tripText}. Reassign those records first.`
        }
      );
    }

    const userPoolId =
      process.env
        .COGNITO_USER_POOL_ID;

    if (!userPoolId) {
      return jsonResponse(
        500,
        {
          message:
            "Cognito user removal has not been configured."
        }
      );
    }

    let cognitoDisabled =
      false;

    try {
      await cognitoClient.send(
        new AdminDisableUserCommand({
          UserPoolId:
            userPoolId,

          Username:
            candidate.email
        })
      );

      cognitoDisabled =
        true;

      const deactivated =
        await deactivateIpcmUser(
          currentUser.companyId,
          candidate.id
        );

      if (!deactivated) {
        throw new Error(
          "IPCM_DATABASE_DEACTIVATION_FAILED"
        );
      }
    } catch (error) {
      if (
        cognitoDisabled
      ) {
        try {
          await cognitoClient.send(
            new AdminEnableUserCommand({
              UserPoolId:
                userPoolId,

              Username:
                candidate.email
            })
          );
        } catch (
          rollbackError
        ) {
          console.error(
            "Unable to re-enable Cognito IPCM after failed removal",
            rollbackError
          );
        }
      }

      throw error;
    }

    return jsonResponse(
      200,
      {
        message:
          `${candidate.email} was removed from active IPCM access.`
      }
    );
  } catch (error) {
    console.error(
      "DELETE /ipcms/{id} failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to remove the IPCM."
      }
    );
  }
}