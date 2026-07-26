import {
  SESv2Client,
  SendEmailCommand
} from "@aws-sdk/client-sesv2";

export type SendEmailRequest = {
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
};

export type SendEmailResult = {
  messageId: string;
};

const sesClient = new SESv2Client({});

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isSendEmailRequest(value: unknown): value is SendEmailRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as Partial<SendEmailRequest>;

  return (
    typeof request.to === "string" &&
    isValidEmail(request.to) &&
    typeof request.subject === "string" &&
    request.subject.trim().length > 0 &&
    typeof request.textBody === "string" &&
    request.textBody.trim().length > 0 &&
    (request.htmlBody === undefined ||
      typeof request.htmlBody === "string")
  );
}

function getErrorDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}

export async function handler(
  event: unknown
): Promise<SendEmailResult> {
  console.log("Email service request received");

  const sourceEmail = process.env.SES_SOURCE_EMAIL;

  if (!sourceEmail) {
    throw new Error(
      "SES_SOURCE_EMAIL environment variable is missing."
    );
  }

  if (!isSendEmailRequest(event)) {
    throw new Error(
      "Email service received an invalid request payload."
    );
  }

  try {
    const response = await sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: sourceEmail,
        Destination: {
          ToAddresses: [event.to]
        },
        Content: {
          Simple: {
            Subject: {
              Data: event.subject,
              Charset: "UTF-8"
            },
            Body: {
              Text: {
                Data: event.textBody,
                Charset: "UTF-8"
              },
              ...(event.htmlBody
                ? {
                    Html: {
                      Data: event.htmlBody,
                      Charset: "UTF-8"
                    }
                  }
                : {})
            }
          }
        }
      })
    );

    if (!response.MessageId) {
      throw new Error(
        "Amazon SES accepted the request but did not return a message ID."
      );
    }

    console.log("Email sent through Amazon SES", {
      messageId: response.MessageId,
      destinationEmail: event.to
    });

    return {
      messageId: response.MessageId
    };
  } catch (error) {
    console.error(
      "Email service failed",
      getErrorDetails(error)
    );

    throw error;
  }
}