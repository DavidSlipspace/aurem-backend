import { emailLayout, emailParagraph, emailButton } from "../services/email/emailLayout";

import type {
  CustomMessageTriggerEvent
} from "aws-lambda";

export async function handler(
  event:
    CustomMessageTriggerEvent
): Promise<
  CustomMessageTriggerEvent
> {
  if (
    event.triggerSource !==
    "CustomMessage_ForgotPassword"
  ) {
    return event;
  }

  const frontendBaseUrl =
    process.env
      .FRONTEND_BASE_URL;

  if (!frontendBaseUrl) {
    throw new Error(
      "FRONTEND_BASE_URL is not configured."
    );
  }

  const email =
    event.request
      .userAttributes
      .email ??
    event.userName;

  const baseUrl =
    frontendBaseUrl.replace(
      /\/+$/,
      ""
    );

  /*
   * Keep Cognito's code placeholder literally
   * inside the message. Cognito replaces this
   * value with the real reset code before the
   * message is delivered.
   *
   * A URL fragment is used so the reset code
   * is not sent to a web server in the HTTP
   * request. The SPA reads it from location.hash.
   */
  const resetUrl =
    `${baseUrl}/reset-password` +
    `?email=${encodeURIComponent(
      email
    )}` +
    `#code=${event.request.codeParameter}`;

  event.response.emailSubject =
    "Reset your Orvo password";

  event.response.emailMessage = emailLayout({
    category: "Account recovery",
    title: "Reset your Orvo password",
    bodyHtml: emailParagraph("We received a request to reset the password for your Orvo account. Use the secure link below to choose a new password.") + emailButton("Reset password", resetUrl),
    notice: "If you did not request a password reset, you can ignore this email. Your password will remain unchanged."
  });

  return event;
}