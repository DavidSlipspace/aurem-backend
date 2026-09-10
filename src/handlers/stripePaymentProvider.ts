import {
  GetSecretValueCommand,
  SecretsManagerClient
} from "@aws-sdk/client-secrets-manager";

import Stripe from "stripe";

type CreateCustomerRequest = {
  action:
    "create_customer";

  email:
    string;

  name:
    string;

  auremUserId:
    string;
};

type CreateAchSetupIntentRequest = {
  action:
    "create_ach_setup_intent";

  customerId:
    string;
};

type RetrieveAchSetupIntentRequest = {
  action:
    "retrieve_ach_setup_intent";

  setupIntentId:
    string;
};

type DetachPaymentMethodRequest = {
  action:
    "detach_payment_method";

  paymentMethodId:
    string;
};

type StripeProviderRequest =
  | CreateCustomerRequest
  | CreateAchSetupIntentRequest
  | RetrieveAchSetupIntentRequest
  | DetachPaymentMethodRequest;

const secretsClient =
  new SecretsManagerClient(
    {}
  );

let cachedStripe:
  Stripe |
  null =
    null;

function isNonEmptyString(
  value:
    unknown
): value is string {
  return (
    typeof value ===
      "string" &&
    value.trim()
      .length >
      0
  );
}

function isRequest(
  value:
    unknown
): value is StripeProviderRequest {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return false;
  }

  const request =
    value as
      Record<
        string,
        unknown
      >;

  if (
    request.action ===
      "create_customer"
  ) {
    return (
      isNonEmptyString(
        request.email
      ) &&
      isNonEmptyString(
        request.name
      ) &&
      isNonEmptyString(
        request.auremUserId
      )
    );
  }

  if (
    request.action ===
      "create_ach_setup_intent"
  ) {
    return isNonEmptyString(
      request.customerId
    );
  }

  if (
    request.action ===
      "retrieve_ach_setup_intent"
  ) {
    return isNonEmptyString(
      request.setupIntentId
    );
  }

  if (
    request.action ===
      "detach_payment_method"
  ) {
    return isNonEmptyString(
      request.paymentMethodId
    );
  }

  return false;
}

async function getStripe():
  Promise<Stripe> {
  if (
    cachedStripe
  ) {
    return cachedStripe;
  }

  const secretArn =
    process.env
      .STRIPE_SECRET_ARN;

  if (
    !secretArn
  ) {
    throw new Error(
      "STRIPE_SECRET_ARN is not configured."
    );
  }

  const secretResponse =
    await secretsClient.send(
      new GetSecretValueCommand({
        SecretId:
          secretArn
      })
    );

  const secretKey =
    secretResponse
      .SecretString
      ?.trim();

  if (
    !secretKey
  ) {
    throw new Error(
      "The Stripe secret does not contain a secret string."
    );
  }

  cachedStripe =
    new Stripe(
      secretKey
    );

  return cachedStripe;
}

function getPaymentMethod(
  setupIntent:
    Stripe.SetupIntent
):
  | Stripe.PaymentMethod
  | null {
  const paymentMethod =
    setupIntent
      .payment_method;

  if (
    !paymentMethod ||
    typeof paymentMethod ===
      "string"
  ) {
    return null;
  }

  return paymentMethod;
}

export async function handler(
  event:
    unknown
): Promise<unknown> {
  if (
    !isRequest(
      event
    )
  ) {
    throw new Error(
      "Stripe payment provider received an invalid request."
    );
  }

  const stripe =
    await getStripe();

  if (
    event.action ===
      "create_customer"
  ) {
    const customer =
      await stripe
        .customers
        .create({
          email:
            event.email,

          name:
            event.name,

          metadata: {
            aurem_user_id:
              event.auremUserId
          }
        });

    return {
      customerId:
        customer.id
    };
  }

  if (
    event.action ===
      "create_ach_setup_intent"
  ) {
    const setupIntent =
      await stripe
        .setupIntents
        .create({
          customer:
            event.customerId,

          payment_method_types: [
            "us_bank_account"
          ],

          usage:
            "off_session"
        });

    if (
      !setupIntent
        .client_secret
    ) {
      throw new Error(
        "Stripe did not return a SetupIntent client secret."
      );
    }

    return {
      setupIntentId:
        setupIntent.id,

      clientSecret:
        setupIntent
          .client_secret
    };
  }

  if (
    event.action ===
      "retrieve_ach_setup_intent"
  ) {
    const setupIntent =
      await stripe
        .setupIntents
        .retrieve(
          event.setupIntentId,
          {
            expand: [
              "payment_method"
            ]
          }
        );

    const paymentMethod =
      getPaymentMethod(
        setupIntent
      );

    const bankAccount =
      paymentMethod
        ?.us_bank_account;

    return {
      setupIntentId:
        setupIntent.id,

      status:
        setupIntent.status,

      customerId:
        typeof setupIntent
          .customer ===
          "string"
          ? setupIntent
              .customer
          : setupIntent
              .customer
              ?.id ??
            null,

      paymentMethodId:
        paymentMethod
          ?.id ??
        null,

      bankName:
        bankAccount
          ?.bank_name ??
        null,

      lastFour:
        bankAccount
          ?.last4 ??
        null,

      bankAccountType:
        bankAccount
          ?.account_type ??
        null
    };
  }

  await stripe
    .paymentMethods
    .detach(
      event.paymentMethodId
    );

  return {
    detached:
      true
  };
}