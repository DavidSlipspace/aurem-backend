import type {
  CustomMessageTriggerEvent
} from "aws-lambda";

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

  const safeUrl =
    escapeHtml(
      resetUrl
    );

  event.response.emailSubject =
    "Reset your Orvo password";

  event.response.emailMessage =
    `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        </head>
        <body
          style="
            margin: 0;
            padding: 0;
            background: #f4f7fb;
            font-family: Arial, Helvetica, sans-serif;
            color: #172b46;
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
              background: #f4f7fb;
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
                    border: 1px solid #dce4ee;
                    border-radius: 16px;
                  "
                >
                  <tr>
                    <td
                      style="
                        padding: 24px 32px;
                        background: #13294B;
                        color: #ffffff;
                        font-size: 30px;
                        font-weight: 700;
                        letter-spacing: -0.03em;
                        border-bottom: 4px solid #5B8FD9;
                        border-radius: 15px 15px 0 0;
                      "
                    >
                      Orvo
                    </td>
                  </tr>

                  <tr>
                    <td
                      style="
                        padding: 36px 32px;
                      "
                    >
                      <p
                        style="
                          margin: 0 0 10px;
                          color: #62748a;
                          font-size: 12px;
                          font-weight: 700;
                          letter-spacing: 0.08em;
                          text-transform: uppercase;
                        "
                      >
                        Account recovery
                      </p>

                      <h1
                        style="
                          margin: 0 0 16px;
                          color: #172b46;
                          font-size: 28px;
                          line-height: 1.2;
                        "
                      >
                        Reset your Orvo password
                      </h1>

                      <p
                        style="
                          margin: 0 0 26px;
                          color: #172b46;
                          font-size: 16px;
                          line-height: 1.6;
                        "
                      >
                        We received a request to reset
                        the password for your Orvo
                        account. Use the secure link
                        below to choose a new password.
                      </p>

                      <a
                        href="${safeUrl}"
                        style="
                          display: inline-block;
                          padding: 14px 24px;
                          border-radius: 8px;
                          background: #13294B;
                          color: #ffffff;
                          font-size: 15px;
                          font-weight: 700;
                          text-decoration: none;
                        "
                      >
                        Reset password
                      </a>

                      <p
                        style="
                          margin: 26px 0 0;
                          color: #62748a;
                          font-size: 13px;
                          line-height: 1.5;
                        "
                      >
                        If you did not request a password
                        reset, you can ignore this email. Your password will remain unchanged.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `.trim();

  return event;
}