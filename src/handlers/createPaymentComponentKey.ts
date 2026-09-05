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

type ProviderResponse = {
  componentClientKey?:
    string;
};

const lambdaClient =
  new LambdaClient(
    {}
  );

function decodePayload(
  payload:
    Uint8Array |
    undefined
): string {
  if (
    !payload
  ) {
    return "";
  }

  return new TextDecoder()
    .decode(
      payload
    );
}

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
      "ipcm"
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Only IPCM users can configure payment methods."
        }
      );
    }

    const providerFunctionName =
      process.env
        .PAYMENT_PROVIDER_FUNCTION_NAME;

    if (
      !providerFunctionName
    ) {
      return jsonResponse(
        500,
        {
          message:
            "Payment card setup is not configured."
        }
      );
    }

    const response =
      await lambdaClient.send(
        new InvokeCommand({
          FunctionName:
            providerFunctionName,

          InvocationType:
            "RequestResponse",

          Payload:
            Buffer.from(
              JSON.stringify({
                action:
                  "create_component_key"
              })
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
      console.error(
        "Payment provider returned an error",
        {
          functionError:
            response.FunctionError,

          errorPayload:
            responseText
        }
      );

      throw new Error(
        "The secure card provider could not start card setup."
      );
    }

    const providerResponse =
      JSON.parse(
        responseText ||
          "{}"
      ) as
        ProviderResponse;

    if (
      !providerResponse
        .componentClientKey
    ) {
      throw new Error(
        "The secure card provider did not return a component key."
      );
    }

    return jsonResponse(
      200,
      {
        componentClientKey:
          providerResponse
            .componentClientKey
      }
    );
  } catch (
    error
  ) {
    console.error(
      "POST /payment-methods/component-key failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to start secure card setup."
      }
    );
  }
}