
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  InvokeCommand,
  LambdaClient
} from "@aws-sdk/client-lambda";

import { getPool } from "../db/pool";
import { getCurrentUser } from "../common/currentUser";
import { jsonResponse } from "../common/response";

type CustomerRow = {
  provider_customer_id: string;
};

type ExistingMethodRow = {
  provider: string;
  provider_payment_method_id: string;
};

type StripeCardSetupResponse = {
  status?: string;
  customerId?: string | null;
  paymentMethodId?: string | null;
  paymentMethodType?: string | null;
  cardBrand?: string | null;
  lastFour?: string | null;
};

const lambdaClient = new LambdaClient({});

async function invokeProvider(
  functionName: string,
  request: unknown
): Promise<any> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "RequestResponse",
      Payload: Buffer.from(JSON.stringify(request))
    })
  );

  const payload = new TextDecoder().decode(response.Payload);

  if (response.FunctionError) {
    console.error("Stripe provider error", payload);
    throw new Error("Secure card verification failed.");
  }

  return JSON.parse(payload || "{}");
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const currentUser = await getCurrentUser(event);

    if (!currentUser || currentUser.roleName !== "ipcm") {
      return jsonResponse(403, {
        message: "Only Case Manager users can manage payment methods."
      });
    }

    let body: { setupIntentId?: unknown; displayName?: unknown };

    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return jsonResponse(400, { message: "Invalid request body." });
    }

    const setupIntentId =
      typeof body.setupIntentId === "string"
        ? body.setupIntentId.trim()
        : "";

    if (!setupIntentId.startsWith("seti_")) {
      return jsonResponse(400, {
        message: "A valid Stripe SetupIntent ID is required."
      });
    }

    const providerFunctionName =
      process.env.STRIPE_PAYMENT_PROVIDER_FUNCTION_NAME;

    if (!providerFunctionName) {
      return jsonResponse(500, {
        message: "Secure card setup is not configured."
      });
    }

    const pool = getPool();

    const customerResult = await pool.query<CustomerRow>(
      `
      SELECT provider_customer_id
      FROM ipcm_payment_provider_customers
      WHERE user_id = $1
        AND company_id = $2
        AND provider = 'stripe'
      LIMIT 1;
      `,
      [currentUser.id, currentUser.companyId]
    );

    const expectedCustomerId =
      customerResult.rows[0]?.provider_customer_id;

    if (!expectedCustomerId) {
      return jsonResponse(409, {
        message: "No Stripe customer mapping exists for this Case Manager."
      });
    }

    const setup = await invokeProvider(
      providerFunctionName,
      {
        action: "retrieve_card_setup_intent",
        setupIntentId
      }
    ) as StripeCardSetupResponse;

    if (setup.customerId !== expectedCustomerId) {
      return jsonResponse(403, {
        message: "This card setup session does not belong to this user."
      });
    }

    if (setup.status !== "succeeded") {
      return jsonResponse(400, {
        message: "The card setup has not been completed successfully."
      });
    }

    if (setup.paymentMethodType !== "card") {
      return jsonResponse(400, {
        message: "The Stripe payment method is not a card."
      });
    }

    const paymentMethodId = setup.paymentMethodId;
    const cardBrand = setup.cardBrand;
    const lastFour = setup.lastFour;

    if (
      !paymentMethodId?.startsWith("pm_") ||
      !cardBrand ||
      !lastFour ||
      !/^\d{4}$/.test(lastFour)
    ) {
      return jsonResponse(400, {
        message: "Stripe returned incomplete card information."
      });
    }

    const existingResult = await pool.query<ExistingMethodRow>(
      `
      SELECT provider, provider_payment_method_id
      FROM ipcm_payment_methods
      WHERE user_id = $1
        AND payment_method_type = 'card'
      LIMIT 1;
      `,
      [currentUser.id]
    );

    const previous = existingResult.rows[0];

    const displayName =
      typeof body.displayName === "string" &&
      body.displayName.trim()
        ? body.displayName.trim().slice(0, 120)
        : `${cardBrand} ending in ${lastFour}`;

    await pool.query(
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
        $1, $2, 'card', 'stripe', $3, $4, $5, $6,
        NULL, NULL, 'active', true
      )
      ON CONFLICT (user_id, payment_method_type)
      DO UPDATE SET
        company_id = EXCLUDED.company_id,
        provider = EXCLUDED.provider,
        provider_payment_method_id =
          EXCLUDED.provider_payment_method_id,
        display_name = EXCLUDED.display_name,
        card_brand = EXCLUDED.card_brand,
        last_four = EXCLUDED.last_four,
        bank_name = NULL,
        bank_account_type = NULL,
        status = 'active',
        is_default = true,
        updated_at = CURRENT_TIMESTAMP;
      `,
      [
        currentUser.id,
        currentUser.companyId,
        paymentMethodId,
        displayName,
        cardBrand,
        lastFour
      ]
    );

    if (
      previous?.provider === "stripe" &&
      previous.provider_payment_method_id !== paymentMethodId
    ) {
      try {
        await invokeProvider(providerFunctionName, {
          action: "detach_payment_method",
          paymentMethodId: previous.provider_payment_method_id
        });
      } catch (error) {
        console.error("Unable to detach previous Stripe card", error);
      }
    }

    return jsonResponse(200, {
      message: "Credit card saved successfully.",
      status: "active",
      paymentMethod: {
        provider: "stripe",
        providerPaymentMethodId: paymentMethodId,
        cardBrand,
        lastFour
      }
    });
  } catch (error) {
    console.error("POST /payment-methods/card/confirm failed", error);

    return jsonResponse(500, {
      message: "Unable to save the credit card."
    });
  }
}
