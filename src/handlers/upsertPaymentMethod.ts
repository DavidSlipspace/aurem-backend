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

type PaymentMethodIntakeBody = {
  type?:
    unknown;

  providerPaymentMethodId?:
    unknown;

  displayName?:
    unknown;

  cardBrand?:
    unknown;

  lastFour?:
    unknown;
};

type ExistingPaymentMethodRow = {
  provider:
    string;

  provider_payment_method_id:
    string;
};

const lambdaClient =
  new LambdaClient(
    {}
  );

function optionalString(
  value:
    unknown
): string | null {
  if (
    typeof value !==
    "string"
  ) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized ||
    null;
}

async function deleteOldDuffelCard(
  cardId:
    string
): Promise<void> {
  const providerFunctionName =
    process.env
      .PAYMENT_PROVIDER_FUNCTION_NAME;

  if (
    !providerFunctionName
  ) {
    console.warn(
      "Unable to remove replaced Duffel card because PAYMENT_PROVIDER_FUNCTION_NAME is not configured."
    );

    return;
  }

  try {
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
                  "delete_card",

                cardId
              })
            )
        })
      );

    if (
      response.FunctionError
    ) {
      console.error(
        "Duffel card cleanup failed",
        {
          cardId,

          functionError:
            response.FunctionError
        }
      );
    }
  } catch (
    error
  ) {
    /*
     * The new card has already
     * been saved successfully.
     * Cleanup failure should not
     * roll back the user's new
     * payment method.
     */
    console.error(
      "Unable to remove replaced Duffel card",
      {
        cardId,
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
            "Only IPCM users can manage their payment profile."
        }
      );
    }

    let body:
      PaymentMethodIntakeBody;

    try {
      body =
        JSON.parse(
          event.body ??
            "{}"
        ) as
          PaymentMethodIntakeBody;
    } catch {
      return jsonResponse(
        400,
        {
          message:
            "Invalid request body."
        }
      );
    }

    if (
      body.type !==
      "card"
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Card is the only payment method currently enabled."
        }
      );
    }

    const providerPaymentMethodId =
      optionalString(
        body.providerPaymentMethodId
      );

    const cardBrand =
      optionalString(
        body.cardBrand
      );

    const lastFour =
      optionalString(
        body.lastFour
      );

    const displayName =
      optionalString(
        body.displayName
      );

    if (
      !providerPaymentMethodId ||
      !providerPaymentMethodId
        .startsWith(
          "tcd_"
        )
    ) {
      return jsonResponse(
        400,
        {
          message:
            "A valid Duffel card reference is required."
        }
      );
    }

    if (
      !cardBrand
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Card brand is required."
        }
      );
    }

    if (
      !lastFour ||
      !/^\d{4}$/.test(
        lastFour
      )
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Valid masked card digits are required."
        }
      );
    }

    const pool =
      getPool();

    const existingResult =
      await pool
        .query<
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
              'card'

          LIMIT 1;
          `,
          [
            currentUser.id
          ]
        );

    const existingMethod =
      existingResult.rows[0];

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
        'card',
        'duffel',
        $3,
        $4,
        $5,
        $6,
        NULL,
        NULL,
        'active',
        true
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
          EXCLUDED.card_brand,

        last_four =
          EXCLUDED.last_four,

        bank_name =
          NULL,

        bank_account_type =
          NULL,

        status =
          'active',

        is_default =
          true,

        updated_at =
          CURRENT_TIMESTAMP;
      `,
      [
        currentUser.id,

        currentUser.companyId,

        providerPaymentMethodId,

        displayName,

        cardBrand,

        lastFour
      ]
    );

    if (
      existingMethod?.provider ===
        "duffel" &&
      existingMethod
        .provider_payment_method_id !==
        providerPaymentMethodId
    ) {
      await deleteOldDuffelCard(
        existingMethod
          .provider_payment_method_id
      );
    }

    return jsonResponse(
      200,
      {
        message:
          existingMethod
            ? "Travel card replaced successfully."
            : "Travel card saved successfully."
      }
    );
  } catch (
    error
  ) {
    console.error(
      "POST /payment-methods failed",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to save the travel card."
      }
    );
  }
}