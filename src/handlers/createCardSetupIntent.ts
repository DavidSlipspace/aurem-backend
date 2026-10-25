
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

type UserRow = {
  first_name: string;
  last_name: string;
  email: string;
};

type CustomerRow = {
  provider_customer_id: string;
};

type CreateCustomerResponse = {
  customerId?: string;
};

type CreateSetupResponse = {
  setupIntentId?: string;
  clientSecret?: string;
};

const lambdaClient = new LambdaClient({});

async function invokeStripeProvider(
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
    throw new Error("Secure card setup is unavailable.");
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
        message: "Only Case Manager users can configure payment methods."
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

    const [userResult, customerResult] = await Promise.all([
      pool.query<UserRow>(
        `
        SELECT first_name, last_name, email
        FROM users
        WHERE id = $1
          AND company_id = $2
          AND status = 'active'
        LIMIT 1;
        `,
        [currentUser.id, currentUser.companyId]
      ),
      pool.query<CustomerRow>(
        `
        SELECT provider_customer_id
        FROM ipcm_payment_provider_customers
        WHERE user_id = $1
          AND company_id = $2
          AND provider = 'stripe'
        LIMIT 1;
        `,
        [currentUser.id, currentUser.companyId]
      )
    ]);

    const user = userResult.rows[0];

    if (!user) {
      return jsonResponse(404, {
        message: "Unable to locate the Case Manager account."
      });
    }

    let customerId = customerResult.rows[0]?.provider_customer_id;

    if (!customerId) {
      const created = await invokeStripeProvider(
        providerFunctionName,
        {
          action: "create_customer",
          email: user.email,
          name: `${user.first_name} ${user.last_name}`.trim(),
          auremUserId: currentUser.id
        }
      ) as CreateCustomerResponse;

      if (!created.customerId) {
        throw new Error("Stripe did not return a customer ID.");
      }

      const inserted = await pool.query<CustomerRow>(
        `
        INSERT INTO ipcm_payment_provider_customers (
          user_id,
          company_id,
          provider,
          provider_customer_id
        )
        VALUES ($1, $2, 'stripe', $3)
        ON CONFLICT (user_id, provider)
        DO UPDATE SET
          company_id = EXCLUDED.company_id,
          updated_at = CURRENT_TIMESTAMP
        RETURNING provider_customer_id;
        `,
        [currentUser.id, currentUser.companyId, created.customerId]
      );

      customerId = inserted.rows[0].provider_customer_id;
    }

    const setup = await invokeStripeProvider(
      providerFunctionName,
      {
        action: "create_card_setup_intent",
        customerId
      }
    ) as CreateSetupResponse;

    if (!setup.setupIntentId || !setup.clientSecret) {
      throw new Error("Stripe did not return a valid card setup session.");
    }

    return jsonResponse(200, {
      setupIntentId: setup.setupIntentId,
      clientSecret: setup.clientSecret
    });
  } catch (error) {
    console.error("POST /payment-methods/card/setup failed", error);

    return jsonResponse(500, {
      message: "Unable to start secure card setup."
    });
  }
}
