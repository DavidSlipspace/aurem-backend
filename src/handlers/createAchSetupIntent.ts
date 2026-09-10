import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

import {
  getPool
} from "../db/pool";

import {
  getCurrentUser
} from "../common/currentUser";

import {
  jsonResponse
} from "../common/response";

type CurrentUserDetailsRow = {
  first_name:
    string;

  last_name:
    string;

  email:
    string;
};

type ProviderCustomerRow = {
  provider_customer_id:
    string;
};

type CreateCustomerResponse = {
  customerId?:
    string;
};

type CreateSetupIntentResponse = {
  setupIntentId?:
    string;

  clientSecret?:
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

async function invokeProvider(
  functionName:
    string,

  payload:
    unknown
): Promise<unknown> {
  const response =
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName:
          functionName,

        InvocationType:
          "RequestResponse",

        Payload:
          Buffer.from(
            JSON.stringify(
              payload
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
    console.error(
      "Stripe provider returned an error",
      {
        functionError:
          response.FunctionError,

        payload:
          responseText
      }
    );

    throw new Error(
      "The secure bank account provider could not complete the request."
    );
  }

  return JSON.parse(
    responseText ||
      "{}"
  ) as unknown;
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
            "Only Case Manager users can configure payment methods."
        }
      );
    }

    const providerFunctionName =
      process.env
        .STRIPE_PAYMENT_PROVIDER_FUNCTION_NAME;

    if (
      !providerFunctionName
    ) {
      return jsonResponse(
        500,
        {
          message:
            "Secure bank account setup is not configured."
        }
      );
    }

    const pool =
      getPool();

    const [
      userResult,
      customerResult
    ] =
      await Promise.all([
        pool.query<
          CurrentUserDetailsRow
        >(
          `
          SELECT
            first_name,
            last_name,
            email

          FROM
            users

          WHERE
            id = $1

            AND
            company_id = $2

            AND
            status = 'active'

          LIMIT 1;
          `,
          [
            currentUser.id,
            currentUser.companyId
          ]
        ),

        pool.query<
          ProviderCustomerRow
        >(
          `
          SELECT
            provider_customer_id

          FROM
            ipcm_payment_provider_customers

          WHERE
            user_id = $1

            AND
            company_id = $2

            AND
            provider = 'stripe'

          LIMIT 1;
          `,
          [
            currentUser.id,
            currentUser.companyId
          ]
        )
      ]);

    const user =
      userResult.rows[0];

    if (
      !user
    ) {
      return jsonResponse(
        404,
        {
          message:
            "Unable to locate the Case Manager account."
        }
      );
    }

    let customerId =
      customerResult
        .rows[0]
        ?.provider_customer_id;

    if (
      !customerId
    ) {
      const providerResponse =
        await invokeProvider(
          providerFunctionName,
          {
            action:
              "create_customer",

            email:
              user.email,

            name:
              `${user.first_name} ${user.last_name}`
                .trim(),

            auremUserId:
              currentUser.id
          }
        ) as
          CreateCustomerResponse;

      customerId =
        providerResponse
          .customerId;

      if (
        !customerId
      ) {
        throw new Error(
          "Stripe did not return a customer ID."
        );
      }

      const insertResult =
        await pool.query<
          ProviderCustomerRow
        >(
          `
          INSERT INTO
            ipcm_payment_provider_customers (
              user_id,
              company_id,
              provider,
              provider_customer_id
            )

          VALUES (
            $1,
            $2,
            'stripe',
            $3
          )

          ON CONFLICT (
            user_id,
            provider
          )

          DO UPDATE

          SET
            company_id =
              EXCLUDED.company_id,

            updated_at =
              CURRENT_TIMESTAMP

          RETURNING
            provider_customer_id;
          `,
          [
            currentUser.id,
            currentUser.companyId,
            customerId
          ]
        );

      customerId =
        insertResult
          .rows[0]
          .provider_customer_id;
    }

    const setupResponse =
      await invokeProvider(
        providerFunctionName,
        {
          action:
            "create_ach_setup_intent",

          customerId
        }
      ) as
        CreateSetupIntentResponse;

    if (
      !setupResponse
        .setupIntentId ||
      !setupResponse
        .clientSecret
    ) {
      throw new Error(
        "Stripe did not return a valid bank account setup session."
      );
    }

    return jsonResponse(
      200,
      {
        setupIntentId:
          setupResponse
            .setupIntentId,

        clientSecret:
          setupResponse
            .clientSecret
      }
    );
  } catch (
    error
  ) {
    console.error(
      "POST /payment-methods/ach/setup failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          error instanceof Error
            ? error.message
            : "Unable to start secure bank account setup."
      }
    );
  }
}