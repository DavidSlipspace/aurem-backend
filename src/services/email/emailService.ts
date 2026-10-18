import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

export type TransactionalEmailRequest = {
  to: string;

  subject: string;

  textBody: string;

  htmlBody?: string;
};

export type TransactionalEmailResult = {
  messageId: string;
};

const lambdaClient =
  new LambdaClient(
    {}
  );

function decodePayload(
  payload:
    | Uint8Array
    | undefined
): string {
  if (!payload) {
    return "";
  }

  return new TextDecoder()
    .decode(
      payload
    );
}

export async function sendTransactionalEmail(
  request:
    TransactionalEmailRequest
): Promise<TransactionalEmailResult> {
  const functionName =
    process.env
      .EMAIL_SERVICE_FUNCTION_NAME;

  if (!functionName) {
    throw new Error(
      "EMAIL_SERVICE_FUNCTION_NAME is not configured."
    );
  }

  const response =
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName:
          functionName,

        InvocationType:
          "RequestResponse",

        Payload:
          new TextEncoder()
            .encode(
              JSON.stringify(
                request
              )
            )
      })
    );

  const responseText =
    decodePayload(
      response.Payload
    );

  if (
    response.FunctionError
  ) {
    throw new Error(
      responseText ||
        "The email service returned an error."
    );
  }

  if (!responseText) {
    throw new Error(
      "The email service returned an empty response."
    );
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        responseText
      );
  } catch {
    throw new Error(
      "The email service returned invalid JSON."
    );
  }

  if (
    typeof parsed !==
      "object" ||
    parsed === null ||
    !(
      "messageId" in
      parsed
    ) ||
    typeof parsed.messageId !==
      "string"
  ) {
    throw new Error(
      "The email service did not return a message ID."
    );
  }

  return {
    messageId:
      parsed.messageId
  };
}