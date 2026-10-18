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

  status:
    string;
};

type StripeSetupIntentResponse = {
  setupIntentId?:
    string;

  status?:
    string;

  customerId?:
    | string
    | null;

  paymentMethodId?:
    | string
    | null;

  paymentMethodType?:
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

  nextActionType?:
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

function mapStatus(
  stripeStatus:
    string
):
  | "active"
  | "requires_action"
  | "pending" {
  if (
    stripeStatus ===
      "succeeded"
  ) {
    return "active";
  }

  if (
    stripeStatus ===
      "requires_action"
  ) {
    return "requires_action";
  }

  return "pending";
}

function buildDisplayName(
  bankName:
    string |
    null,

  lastFour:
    string |
    null
): string {
  const label =
    bankName ||
    "Bank account";

  return lastFour
    ? `${label} ending in ${lastFour}`
    : label;
}

async function detachOldStripeMethod(
  providerFunctionName:
    string,

  paymentMethodId:
    string
): Promise<void> {
  try {
    await invokeProvider(
      providerFunctionName,
      {
        action:
          "detach_payment_method",

        paymentMethodId
      }
    );
  } catch (
    error
  ) {
    console.error(
      "Unable to detach replaced Stripe bank account",
      {
        paymentMethodId,
        error
      }
    );
  }
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
            "Only Case Manager users can manage their payment profile."
        }
      );
    }

    let body:
      ConfirmAchBody;

    try {
      body =
        JSON.parse(
          event.body ??
            "{}"
        ) as
          ConfirmAchBody;
    } catch {
      return jsonResponse(
        400,
        {
          message:
            "Invalid request body."
        }
      );
    }

    const setupIntentId =
      typeof body
        .setupIntentId ===
        "string"
        ? body
            .setupIntentId
            .trim()
        : "";

    if (
      !setupIntentId ||
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
      customerResult,
      existingResult
    ] =
      await Promise.all([
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
        ),

        pool.query<
          ExistingPaymentMethodRow
        >(
          `
          SELECT
            provider,
            provider_payment_method_id,
            status

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
        )
      ]);

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
            "No Stripe customer mapping exists for this Case Manager."
        }
      );
    }

    const stripeResponse =
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
      !stripeResponse
        .customerId ||
      stripeResponse
        .customerId !==
        expectedCustomerId
    ) {
      return jsonResponse(
        403,
        {
          message:
            "This bank account setup session does not belong to the authenticated Case Manager."
        }
      );
    }

    if (
      stripeResponse
        .paymentMethodType !==
        "us_bank_account"
    ) {
      return jsonResponse(
        400,
        {
          message:
            "The Stripe payment method is not a US bank account."
        }
      );
    }

    const stripeStatus =
      stripeResponse
        .status ||
      "";

    if (
      ![
        "succeeded",
        "requires_action",
        "processing"
      ].includes(
        stripeStatus
      )
    ) {
      return jsonResponse(
        400,
        {
          message:
            "The bank account setup has not been successfully authorized."
        }
      );
    }

    const paymentMethodId =
      stripeResponse
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
            "Stripe has not returned a reusable bank payment method yet."
        }
      );
    }

    const status =
      mapStatus(
        stripeStatus
      );

    const bankName =
      stripeResponse
        .bankName ??
      null;

    const lastFour =
      stripeResponse
        .lastFour ??
      null;

    const bankAccountType =
      stripeResponse
        .bankAccountType ??
      null;

    if (
      lastFour &&
      !/^\d{4}$/.test(
        lastFour
      )
    ) {
      throw new Error(
        "Stripe returned invalid masked bank account digits."
      );
    }

    const existingMethod =
      existingResult
        .rows[0];

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
        buildDisplayName(
          bankName,
          lastFour
        ),
        lastFour,
        bankName,
        bankAccountType,
        status
      ]
    );

    /*
     * Only detach the previous
     * account after the new bank
     * account is fully active.
     *
     * If Stripe requires
     * microdeposit verification,
     * retaining the old Stripe
     * account gives us a safer
     * migration path when webhook
     * handling is added later.
     */
    if (
      status ===
        "active" &&
      existingMethod
        ?.provider ===
        "stripe" &&
      existingMethod
        .provider_payment_method_id !==
        paymentMethodId
    ) {
      await detachOldStripeMethod(
        providerFunctionName,
        existingMethod
          .provider_payment_method_id
      );
    }

    const message =
      status ===
        "active"
        ? "Bank account connected successfully."
        : status ===
            "requires_action"
          ? "Bank account saved. Stripe requires an additional verification step before it can be used."
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

          bankAccountType
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
          error instanceof Error
            ? error.message
            : "Unable to save the bank account."
      }
    );
  }
}