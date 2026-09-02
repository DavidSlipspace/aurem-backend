import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  randomUUID
} from "node:crypto";

import {
  getPool
} from "../db/pool";

import {
  getCurrentUser
} from "../common/currentUser";

import {
  jsonResponse
} from "../common/response";

type PaymentMethodType =
  | "card"
  | "bank_account";

type PaymentMethodIntakeBody = {
  type?: unknown;

  displayName?: unknown;

  cardBrand?: unknown;

  lastFour?: unknown;

  bankName?: unknown;

  bankAccountType?: unknown;
};

function optionalString(
  value: unknown
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

function isPaymentMethodType(
  value: unknown
): value is PaymentMethodType {
  return (
    value ===
      "card" ||
    value ===
      "bank_account"
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
            "Only IPCM users can manage their payment profile."
        }
      );
    }

    const body =
      JSON.parse(
        event.body ??
          "{}"
      ) as
        PaymentMethodIntakeBody;

    if (
      !isPaymentMethodType(
        body.type
      )
    ) {
      return jsonResponse(
        400,
        {
          message:
            "A valid payment method type is required."
        }
      );
    }

    const lastFour =
      optionalString(
        body.lastFour
      );

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
            "Exactly four masked ending digits are required."
        }
      );
    }

    const displayName =
      optionalString(
        body.displayName
      );

    const cardBrand =
      body.type ===
      "card"
        ? optionalString(
            body.cardBrand
          )
        : null;

    const bankName =
      body.type ===
      "bank_account"
        ? optionalString(
            body.bankName
          )
        : null;

    const bankAccountType =
      body.type ===
      "bank_account"
        ? optionalString(
            body.bankAccountType
          )
        : null;

    if (
      body.type ===
        "card" &&
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
      body.type ===
        "bank_account" &&
      (
        !bankName ||
        !bankAccountType
      )
    ) {
      return jsonResponse(
        400,
        {
          message:
            "Bank name and account type are required."
        }
      );
    }

    const providerReference =
      `manual-intake:${randomUUID()}`;

    await getPool().query(
      `
      INSERT INTO ipcm_payment_methods (
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
        $3,
        'manual_intake',
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        'pending',
        false
      )

      ON CONFLICT (
        user_id,
        payment_method_type
      )
      DO UPDATE

      SET
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
          EXCLUDED.bank_name,

        bank_account_type =
          EXCLUDED.bank_account_type,

        status =
          'pending',

        is_default =
          false,

        updated_at =
          CURRENT_TIMESTAMP;
      `,
      [
        currentUser.id,

        currentUser.companyId,

        body.type,

        providerReference,

        displayName,

        cardBrand,

        lastFour,

        bankName,

        bankAccountType
      ]
    );

    return jsonResponse(
      200,
      {
        message:
          "Payment profile saved. This intake record is pending connection to a tokenized payment provider."
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
          "Unable to save payment profile."
      }
    );
  }
}