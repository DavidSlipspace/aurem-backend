import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import Stripe from "stripe";

type Request =
  | { action: "create_customer"; email: string; name: string; auremUserId: string }
  | { action: "create_ach_setup_intent" | "create_card_setup_intent"; customerId: string }
  | { action: "retrieve_ach_setup_intent" | "retrieve_card_setup_intent"; setupIntentId: string }
  | { action: "detach_payment_method"; paymentMethodId: string };

const secretsClient = new SecretsManagerClient({});
let cachedStripe: Stripe | null = null;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  switch (request.action) {
    case "create_customer": return nonEmpty(request.email) && nonEmpty(request.name) && nonEmpty(request.auremUserId);
    case "create_ach_setup_intent":
    case "create_card_setup_intent": return nonEmpty(request.customerId);
    case "retrieve_ach_setup_intent":
    case "retrieve_card_setup_intent": return nonEmpty(request.setupIntentId);
    case "detach_payment_method": return nonEmpty(request.paymentMethodId);
    default: return false;
  }
}

async function getStripe(): Promise<Stripe> {
  if (cachedStripe) return cachedStripe;
  const arn = process.env.STRIPE_SECRET_ARN;
  if (!arn) throw new Error("STRIPE_SECRET_ARN is not configured.");
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }));
  const raw = result.SecretString?.trim();
  if (!raw) throw new Error("Stripe secret is empty.");
  let key = raw;
  if (raw.startsWith("{")) {
    const secret = JSON.parse(raw) as Record<string, unknown>;
    const candidate =
          secret.STRIPE_SECRET_KEY ??
          secret.stripeSecretKey ??
          secret.secretKey ??
          secret.key;
    if (!nonEmpty(candidate)) throw new Error("Stripe secret key not found in secret JSON.");
    key = candidate;
  }
  cachedStripe = new Stripe(key);
  return cachedStripe;
}

function expandedPaymentMethod(intent: Stripe.SetupIntent): Stripe.PaymentMethod | null {
  const method = intent.payment_method;
  return method && typeof method !== "string" ? method : null;
}

function customerId(intent: Stripe.SetupIntent): string | null {
  const customer = intent.customer;
  return !customer ? null : typeof customer === "string" ? customer : customer.id;
}

export async function handler(event: unknown): Promise<unknown> {
  if (!isRequest(event)) throw new Error("Invalid Stripe provider request.");
  const stripe = await getStripe();
  switch (event.action) {
    case "create_customer": {
      const customer = await stripe.customers.create({
        email: event.email,
        name: event.name,
        metadata: { aurem_user_id: event.auremUserId }
      }, { idempotencyKey: `aurem-ipcm-${event.auremUserId}` });
      return { customerId: customer.id };
    }
    case "create_ach_setup_intent":
    case "create_card_setup_intent": {
      const intent = await stripe.setupIntents.create({
        customer: event.customerId,
        payment_method_types: [event.action === "create_card_setup_intent" ? "card" : "us_bank_account"],
        usage: "off_session"
      });
      if (!intent.client_secret) throw new Error("Stripe returned no client secret.");
      return { setupIntentId: intent.id, clientSecret: intent.client_secret };
    }
    case "retrieve_ach_setup_intent":
    case "retrieve_card_setup_intent": {
      const intent = await stripe.setupIntents.retrieve(event.setupIntentId, { expand: ["payment_method"] });
      const method = expandedPaymentMethod(intent);
      const common = {
        setupIntentId: intent.id,
        status: intent.status,
        customerId: customerId(intent),
        paymentMethodId: method?.id ?? null,
        paymentMethodType: method?.type ?? null,
        nextActionType: intent.next_action?.type ?? null
      };
      if (event.action === "retrieve_card_setup_intent") {
        return {
          ...common,
          cardBrand: method?.card?.brand ?? null,
          lastFour: method?.card?.last4 ?? null,
          expirationMonth: method?.card?.exp_month ?? null,
          expirationYear: method?.card?.exp_year ?? null
        };
      }
      return {
        ...common,
        bankName: method?.us_bank_account?.bank_name ?? null,
        lastFour: method?.us_bank_account?.last4 ?? null,
        bankAccountType: method?.us_bank_account?.account_type ?? null
      };
    }
    case "detach_payment_method": {
      await stripe.paymentMethods.detach(event.paymentMethodId);
      return { detached: true };
    }
  }
}
