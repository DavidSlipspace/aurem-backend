import { emailLayout, emailParagraph, emailButton, escapeHtml } from "../services/email/emailLayout";

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

import {
  getCurrentUser
} from "../common/currentUser";

import {
  jsonResponse
} from "../common/response";

import type {
  SendEmailRequest,
  SendEmailResult
} from "./sendEmail";

import {
  createIpcmInvitation,
  markIpcmInvitationEmailSent,
  revokeIpcmInvitation
} from "../services/ipcm/ipcmInvitationService";

type InviteIpcmBody = {
  email?: unknown;
};

const lambdaClient =
  new LambdaClient({});

const textEncoder =
  new TextEncoder();

const textDecoder =
  new TextDecoder();

function isValidEmail(
  email: string
): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function parseBody(
  event: APIGatewayProxyEvent
): string | null {
  if (!event.body) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(
        event.body
      ) as InviteIpcmBody;

    if (
      typeof parsed.email !==
      "string"
    ) {
      return null;
    }

    const email =
      parsed.email
        .trim()
        .toLowerCase();

    if (
      !isValidEmail(
        email
      )
    ) {
      return null;
    }

    return email;
  } catch {
    return null;
  }
}

function parseEmailServiceResult(
  payload:
    | Uint8Array
    | undefined
): SendEmailResult {
  if (!payload) {
    throw new Error(
      "The email service returned an empty response."
    );
  }

  const decoded =
    textDecoder.decode(
      payload
    );

  const parsed =
    JSON.parse(
      decoded
    ) as Partial<SendEmailResult>;

  if (
    typeof parsed.messageId !==
      "string" ||
    parsed.messageId.length ===
      0
  ) {
    throw new Error(
      "The email service response did not contain a message ID."
    );
  }

  return {
    messageId:
      parsed.messageId
  };
}

function buildInvitationEmail(
  email: string,
  invitationUrl: string
): SendEmailRequest {
  return {
    to:
      email,

    subject:
      "You've been invited to Orvo",

    textBody:
      [
        "You've been invited to create a Case Manager account in Orvo.",
        "",
        "Use the secure link below to complete your profile:",
        invitationUrl,
        "",
        "This invitation expires in 7 days.",
        "",
        "If you were not expecting this invitation, you can ignore this email."
      ].join(
        "\n"
      ),

    htmlBody: emailLayout({
      category: "Case Manager invitation",
      title: "You've been invited to Orvo",
      bodyHtml: emailParagraph(`An Orvo Administrator has invited <strong>${escapeHtml(email)}</strong> to create a Case Manager account.`) +
        emailParagraph("Use the secure link below to complete your profile and create your account.") +
        emailButton("Create Orvo Account", invitationUrl),
      notice: "This invitation expires in 7 days. If you were not expecting this email, no action is required."
    })
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  const currentUser =
    await getCurrentUser(
      event
    );

  if (!currentUser) {
    return jsonResponse(
      403,
      {
        message:
          "Authenticated user does not exist in the Orvo database."
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
          "Only Administrators can invite Case Managers."
      }
    );
  }

  const email =
    parseBody(
      event
    );

  if (!email) {
    return jsonResponse(
      400,
      {
        message:
          "A valid Case Manager email address is required."
      }
    );
  }

  const emailServiceFunctionName =
    process.env
      .EMAIL_SERVICE_FUNCTION_NAME;

  const frontendBaseUrl =
    process.env
      .FRONTEND_BASE_URL;

  if (
    !emailServiceFunctionName ||
    !frontendBaseUrl
  ) {
    console.error(
      "Case Manager invitation configuration is incomplete.",
      {
        emailServiceConfigured:
          Boolean(
            emailServiceFunctionName
          ),

        frontendBaseUrlConfigured:
          Boolean(
            frontendBaseUrl
          )
      }
    );

    return jsonResponse(
      500,
      {
        message:
          "Case Manager invitations have not been configured."
      }
    );
  }

  let invitationId:
    | string
    | null =
      null;

  try {
    const invitation =
      await createIpcmInvitation(
        currentUser.companyId,
        currentUser.id,
        email
      );

    invitationId =
      invitation.invitationId;

    const baseUrl =
      frontendBaseUrl.replace(
        /\/+$/,
        ""
      );

    const invitationUrl =
      `${baseUrl}/ipcm/invite/` +
      encodeURIComponent(
        invitation.rawToken
      );

    const emailRequest =
      buildInvitationEmail(
        invitation.email,
        invitationUrl
      );

    const invokeResponse =
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName:
            emailServiceFunctionName,

          InvocationType:
            "RequestResponse",

          Payload:
            textEncoder.encode(
              JSON.stringify(
                emailRequest
              )
            )
        })
      );

    if (
      invokeResponse
        .FunctionError
    ) {
      const errorPayload =
        invokeResponse.Payload
          ? textDecoder.decode(
              invokeResponse
                .Payload
            )
          : "No error payload returned.";

      throw new Error(
        `Email service failed: ${errorPayload}`
      );
    }

    const emailResult =
      parseEmailServiceResult(
        invokeResponse.Payload
      );

    await markIpcmInvitationEmailSent(
      invitation.invitationId
    );

    console.log(
      "Case Manager invitation sent",
      {
        invitationId:
          invitation.invitationId,

        email:
          invitation.email,

        messageId:
          emailResult.messageId
      }
    );

    return jsonResponse(
      201,
      {
        message:
          "Case Manager invitation sent successfully.",

        invitation: {
          id:
            invitation.invitationId,

          type:
            "invitation",

          firstName:
            null,

          lastName:
            null,

          email:
            invitation.email,

          status:
            "invited",

          invitationSentAt:
            new Date()
              .toISOString(),

          invitationExpiresAt:
            invitation.expiresAt
        },

        expiresAt:
          invitation.expiresAt,

        sentTo:
          invitation.email
      }
    );
  } catch (error) {
    if (
      invitationId
    ) {
      try {
        await revokeIpcmInvitation(
          invitationId
        );
      } catch (
        revokeError
      ) {
        console.error(
          "Unable to revoke failed Case Manager invitation",
          revokeError
        );
      }
    }

    if (
      error instanceof Error &&
      error.message ===
        "USER_ALREADY_EXISTS"
    ) {
      return jsonResponse(
        409,
        {
          message:
            "A user with this email address already has an Orvo account."
        }
      );
    }

    console.error(
      "POST /ipcms/invitations failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to send the Case Manager invitation."
      }
    );
  }
}