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

type ConfirmAchBody = {
  setupIntentId?:
    unknown;
};

type ProviderCustomerRow = {
  provider_customer_id:
    string;
};

type ExistingPaymentMethodRow = {
  provider:
    string;

  provider_payment_method_id:
    string;
};

type StripeSetupIntentResponse = {
  status?:
    string;

  customerId?:
    | string
    | null;

  paymentMethodId?:
    | string
    | null;

  bankName?:
    | string
    | null;

  lastFour?:
    | string
    | null;

  bankAccountType?:
    | string
    | null;
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

  const text =
    decodePayload(
      response.Payload
    );

  if (
    response.FunctionError
  ) {
    console.error(
      "Stripe provider returned an error",
      text
    );

    throw new Error(
      "The secure bank account provider could not complete the request."
    );
  }

  return JSON.parse(
    text ||
      "{}"
  ) as unknown;
}

function mapStatus(
  status:
    string
):
  | "active"
  | "requires_action"
  | "pending" {
  if (
    status ===
      "succeeded"
  ) {
    return "active";
  }

  if (
    status ===
      "requires_action"
  ) {
    return "requires_action";
  }

  return "pending";
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
      !currentUser ||
      currentUser.roleName !==
        "ipcm"
    ) {
      return jsonResponse(
        403,
        {
          message:
            "Only IPCM users can manage their payment profile."
        }
      );
    }

    const body =
      JSON.parse(
        event.body ??
          "{}"
      ) as
        ConfirmAchBody;

    const setupIntentId =
      typeof body
        .setupIntentId ===
        "string"
        ? body.setupIntentId
            .trim()
        : "";

    if (
      !setupIntentId
        .startsWith(
          "seti_"
        )
    ) {
      return jsonResponse(
        400,
        {
          message:
            "A valid Stripe SetupIntent ID is required."
        }
      );
    }

    const providerFunctionName =
      process.env
        .STRIPE_PAYMENT_PROVIDER_FUNCTION_NAME;

    if (
      !providerFunctionName
    ) {
      throw new Error(
        "Stripe payment provider is not configured."
      );
    }

    const pool =
      getPool();

    const customerResult =
      await pool.query<
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
      );

    const expectedCustomerId =
      customerResult
        .rows[0]
        ?.provider_customer_id;

    if (
      !expectedCustomerId
    ) {
      return jsonResponse(
        409,
        {
          message:
            "No Stripe customer exists for this IPCM."
        }
      );
    }

    const providerResponse =
      await invokeProvider(
        providerFunctionName,
        {
          action:
            "retrieve_ach_setup_intent",

          setupIntentId
        }
      ) as
        StripeSetupIntentResponse;

    if (
      providerResponse
        .customerId !==
      expectedCustomerId
    ) {
      return jsonResponse(
        403,
        {
          message:
            "This bank account setup session does not belong to the authenticated IPCM."
        }
      );
    }

    const paymentMethodId =
      providerResponse
        .paymentMethodId;

    if (
      !paymentMethodId ||
      !paymentMethodId
        .startsWith(
          "pm_"
        )
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Stripe has not returned a reusable bank payment method."
        }
      );
    }

    const status =
      mapStatus(
        providerResponse
          .status ??
        ""
      );

    const oldResult =
      await pool.query<
        ExistingPaymentMethodRow
      >(
        `
        SELECT
          provider,
          provider_payment_method_id

        FROM
          ipcm_payment_methods

        WHERE
          user_id = $1

          AND
          payment_method_type =
            'bank_account'

        LIMIT 1;
        `,
        [
          currentUser.id
        ]
      );

    const bankName =
      providerResponse
        .bankName ??
      null;

    const lastFour =
      providerResponse
        .lastFour ??
      null;

    const accountType =
      providerResponse
        .bankAccountType ??
      null;

    const displayName =
      lastFour
        ? `${bankName || "Bank account"} ending in ${lastFour}`
        : bankName ||
          "Bank account";

    await pool.query(
      `
      INSERT INTO
        ipcm_payment_methods (
          user_id,
          company_id,
          payment_method_type,
          provider,
          provider_payment_method_id,
          display_name,
          card_brand,
          last_four,
          bank_name,
          bank_account_type,
          status,
          is_default
        )

      VALUES (
        $1,
        $2,
        'bank_account',
        'stripe',
        $3,
        $4,
        NULL,
        $5,
        $6,
        $7,
        $8,
        false
      )

      ON CONFLICT (
        user_id,
        payment_method_type
      )

      DO UPDATE

      SET
        company_id =
          EXCLUDED.company_id,

        provider =
          EXCLUDED.provider,

        provider_payment_method_id =
          EXCLUDED.provider_payment_method_id,

        display_name =
          EXCLUDED.display_name,

        card_brand =
          NULL,

        last_four =
          EXCLUDED.last_four,

        bank_name =
          EXCLUDED.bank_name,

        bank_account_type =
          EXCLUDED.bank_account_type,

        status =
          EXCLUDED.status,

        is_default =
          false,

        updated_at =
          CURRENT_TIMESTAMP;
      `,
      [
        currentUser.id,
        currentUser.companyId,
        paymentMethodId,
        displayName,
        lastFour,
        bankName,
        accountType,
        status
      ]
    );

    const oldMethod =
      oldResult.rows[0];

    if (
      oldMethod
        ?.provider ===
        "stripe" &&
      oldMethod
        .provider_payment_method_id !==
        paymentMethodId
    ) {
      try {
        await invokeProvider(
          providerFunctionName,
          {
            action:
              "detach_payment_method",

            paymentMethodId:
              oldMethod
                .provider_payment_method_id
          }
        );
      } catch (
        cleanupError
      ) {
        console.error(
          "Unable to detach replaced Stripe payment method",
          cleanupError
        );
      }
    }

    const message =
      status ===
        "active"
        ? "Bank account connected successfully."
        : status ===
            "requires_action"
          ? "Bank account saved. Stripe requires additional verification before it can be used."
          : "Bank account saved and is pending verification.";

    return jsonResponse(
      200,
      {
        message,

        status,

        paymentMethod: {
          provider:
            "stripe",

          providerPaymentMethodId:
            paymentMethodId,

          bankName,

          lastFour,

          bankAccountType:
            accountType
        }
      }
    );
  } catch (
    error
  ) {
    console.error(
      "POST /payment-methods/ach/confirm failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to save the bank account."
      }
    );
  }
}