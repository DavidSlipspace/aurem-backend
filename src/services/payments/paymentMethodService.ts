import {
  getPool
} from "../../db/pool";

import type {
  IpcmPaymentMethod,
  IpcmPaymentProfile,
  PaymentMethodStatus,
  PaymentMethodType
} from "../../types/payment";

type PaymentMethodRow = {
  user_id: string;

  first_name: string;
  last_name: string;
  email: string;

  payment_method_id:
    | string
    | null;

  payment_method_type:
    | string
    | null;

  provider:
    | string
    | null;

  display_name:
    | string
    | null;

  card_brand:
    | string
    | null;

  last_four:
    | string
    | null;

  bank_name:
    | string
    | null;

  bank_account_type:
    | string
    | null;

  payment_method_status:
    | string
    | null;

  is_default:
    | boolean
    | null;
};

function isPaymentMethodType(
  value: string | null
): value is PaymentMethodType {
  return (
    value === "card" ||
    value === "bank_account"
  );
}

function isPaymentMethodStatus(
  value: string | null
): value is PaymentMethodStatus {
  return (
    value === "pending" ||
    value === "active" ||
    value === "requires_action" ||
    value === "inactive"
  );
}

function toPaymentMethod(
  row: PaymentMethodRow
): IpcmPaymentMethod | null {
  if (
    !row.payment_method_id ||
    !isPaymentMethodType(
      row.payment_method_type
    ) ||
    !row.provider ||
    !isPaymentMethodStatus(
      row.payment_method_status
    )
  ) {
    return null;
  }

  return {
    id:
      row.payment_method_id,

    type:
      row.payment_method_type,

    provider:
      row.provider,

    displayName:
      row.display_name,

    cardBrand:
      row.card_brand,

    lastFour:
      row.last_four,

    bankName:
      row.bank_name,

    bankAccountType:
      row.bank_account_type,

    status:
      row.payment_method_status,

    isDefault:
      Boolean(
        row.is_default
      )
  };
}

function mapRowsToProfiles(
  rows: PaymentMethodRow[]
): IpcmPaymentProfile[] {
  const profiles =
    new Map<
      string,
      IpcmPaymentProfile
    >();

  for (
    const row of rows
  ) {
    let profile =
      profiles.get(
        row.user_id
      );

    if (!profile) {
      profile = {
        userId:
          row.user_id,

        firstName:
          row.first_name,

        lastName:
          row.last_name,

        email:
          row.email,

        card:
          null,

        bankAccount:
          null
      };

      profiles.set(
        row.user_id,
        profile
      );
    }

    const method =
      toPaymentMethod(
        row
      );

    if (!method) {
      continue;
    }

    if (
      method.type ===
      "card"
    ) {
      profile.card =
        method;
    } else {
      profile.bankAccount =
        method;
    }
  }

  return Array.from(
    profiles.values()
  );
}

const BASE_QUERY = `
  SELECT
    u.id
      AS user_id,

    u.first_name,
    u.last_name,
    u.email,

    pm.id
      AS payment_method_id,

    pm.payment_method_type,
    pm.provider,
    pm.display_name,
    pm.card_brand,
    pm.last_four,
    pm.bank_name,
    pm.bank_account_type,

    pm.status
      AS payment_method_status,

    pm.is_default

  FROM users u

  JOIN user_roles ur
    ON ur.user_id =
      u.id

  JOIN roles r
    ON r.id =
      ur.role_id

  LEFT JOIN ipcm_payment_methods pm
    ON pm.user_id =
      u.id

  WHERE
    r.name = 'ipcm'

    AND
      u.status = 'active'
`;

export async function getCompanyIpcmPaymentProfiles(
  companyId: string
): Promise<IpcmPaymentProfile[]> {
  const result =
    await getPool()
      .query<PaymentMethodRow>(
        `
          ${BASE_QUERY}

          AND
            u.company_id = $1

          ORDER BY
            u.last_name,
            u.first_name,
            pm.payment_method_type;
        `,
        [
          companyId
        ]
      );

  return mapRowsToProfiles(
    result.rows
  );
}

export async function getSelfIpcmPaymentProfile(
  userId: string,
  companyId: string
): Promise<IpcmPaymentProfile | null> {
  const result =
    await getPool()
      .query<PaymentMethodRow>(
        `
          ${BASE_QUERY}

          AND
            u.id = $1

          AND
            u.company_id = $2

          ORDER BY
            pm.payment_method_type;
        `,
        [
          userId,
          companyId
        ]
      );

  return (
    mapRowsToProfiles(
      result.rows
    )[0] ??
    null
  );
}