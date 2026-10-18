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

function escapeHtml(
  value: string
): string {
  return value
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
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
  const safeEmail =
    escapeHtml(
      email
    );

  const safeUrl =
    escapeHtml(
      invitationUrl
    );

  return {
    to:
      email,

    subject:
      "You've been invited to Aurem",

    textBody:
      [
        "You've been invited to create an IPCM account in Aurem.",
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

    htmlBody:
      `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />

            <meta
              name="viewport"
              content="width=device-width, initial-scale=1.0"
            />

            <title>
              Aurem Invitation
            </title>
          </head>

          <body
            style="
              margin: 0;
              padding: 0;
              background: #f8fafc;
              font-family:
                Arial,
                Helvetica,
                sans-serif;
              color: #101828;
            "
          >
            <table
              role="presentation"
              width="100%"
              cellspacing="0"
              cellpadding="0"
              border="0"
              style="
                width: 100%;
                background: #f8fafc;
                padding: 32px 16px;
              "
            >
              <tr>
                <td align="center">
                  <table
                    role="presentation"
                    width="100%"
                    cellspacing="0"
                    cellpadding="0"
                    border="0"
                    style="
                      max-width: 600px;
                      background: #ffffff;
                      border:
                        1px solid #e4e7ec;
                      border-radius: 16px;
                      overflow: hidden;
                    "
                  >
                    <tr>
                      <td
                        style="
                          padding:
                            24px 32px;
                          background:
                            #111827;
                          color:
                            #ffffff;
                          font-size:
                            20px;
                          font-weight:
                            700;
                        "
                      >
                        Aurem
                      </td>
                    </tr>

                    <tr>
                      <td
                        style="
                          padding:
                            36px 32px;
                        "
                      >
                        <p
                          style="
                            margin:
                              0 0 10px;
                            color:
                              #667085;
                            font-size:
                              12px;
                            font-weight:
                              700;
                            letter-spacing:
                              0.08em;
                            text-transform:
                              uppercase;
                          "
                        >
                          IPCM Invitation
                        </p>

                        <h1
                          style="
                            margin:
                              0 0 16px;
                            color:
                              #101828;
                            font-size:
                              28px;
                            line-height:
                              1.2;
                          "
                        >
                          You've been invited to Aurem
                        </h1>

                        <p
                          style="
                            margin:
                              0 0 16px;
                            color:
                              #475467;
                            font-size:
                              16px;
                            line-height:
                              1.6;
                          "
                        >
                          An Aurem Administrator
                          has invited
                          <strong>${safeEmail}</strong>
                          to create an IPCM account.
                        </p>

                        <p
                          style="
                            margin:
                              0 0 26px;
                            color:
                              #475467;
                            font-size:
                              16px;
                            line-height:
                              1.6;
                          "
                        >
                          Use the secure link below
                          to complete your profile
                          and create your account.
                        </p>

                        <a
                          href="${safeUrl}"
                          style="
                            display:
                              inline-block;
                            padding:
                              12px 20px;
                            border-radius:
                              8px;
                            background:
                              #111827;
                            color:
                              #ffffff;
                            font-size:
                              15px;
                            font-weight:
                              700;
                            text-decoration:
                              none;
                          "
                        >
                          Create Aurem Account
                        </a>

                        <p
                          style="
                            margin:
                              26px 0 0;
                            color:
                              #667085;
                            font-size:
                              13px;
                            line-height:
                              1.5;
                          "
                        >
                          This invitation expires
                          in 7 days. If you were
                          not expecting this email,
                          no action is required.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `.trim()
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
          "Only Administrators can invite IPCMs."
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
          "A valid IPCM email address is required."
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
      "IPCM invitation configuration is incomplete.",
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
          "IPCM invitations have not been configured."
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
      "IPCM invitation sent",
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
          "IPCM invitation sent successfully.",

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
          "Unable to revoke failed IPCM invitation",
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
            "A user with this email address already has an Aurem account."
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
          "Unable to send the IPCM invitation."
      }
    );
  }
}