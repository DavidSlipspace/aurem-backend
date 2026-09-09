import type {
  PoolClient
} from "pg";

import {
  getPool
} from "../../db/pool";

export type CaseAssignmentOption = {
  id: string;

  firstName: string;

  lastName: string;

  email: string;
};

export type CaseTravelerOption = {
  id: string;

  legalFirstName:
    string;

  legalMiddleName:
    | string
    | null;

  legalLastName:
    string;

  email: string;
};

export type CaseFormOptions = {
  caseManagers:
    CaseAssignmentOption[];

  travelers:
    CaseTravelerOption[];
};

export type CaseMutationInput = {
  caseReferenceId:
    string;

  ipcmUserId:
    string;

  travelerProfileIds:
    string[];

  suggestedBudgetCents:
    | number
    | null;

  status:
    string;
};

export type CaseMutationResult = {
  id: string;

  caseReferenceId:
    string;

  ipcmUserId:
    string;

  ipcmFirstName:
    string;

  ipcmLastName:
    string;

  ipcmEmail:
    string;

  ipcmChanged:
    boolean;
};

type UserAssignmentRow = {
  id: string;

  first_name:
    string;

  last_name:
    string;

  email: string;
};

type ExistingCaseRow = {
  id: string;

  ipcm_user_id:
    string;
};

export class CaseServiceError
  extends Error {
  code: string;

  constructor(
    code: string,
    message: string
  ) {
    super(
      message
    );

    this.name =
      "CaseServiceError";

    this.code =
      code;
  }
}

function normalizeReference(
  value: string
): string {
  return value
    .trim();
}

function normalizeStatus(
  value: string
): string {
  return value
    .trim()
    .toLowerCase();
}

function normalizeTravelerIds(
  travelerProfileIds:
    string[]
): string[] {
  return Array.from(
    new Set(
      travelerProfileIds
        .map(
          (
            id
          ) =>
            id.trim()
        )
        .filter(Boolean)
    )
  );
}

async function getIpcmUser(
  client:
    PoolClient,

  companyId:
    string,

  userId:
    string
): Promise<UserAssignmentRow> {
  const result =
    await client.query<
      UserAssignmentRow
    >(
      `
      SELECT DISTINCT
        u.id,
        u.first_name,
        u.last_name,
        u.email

      FROM users u

      JOIN user_roles ur
        ON ur.user_id =
          u.id

      JOIN roles r
        ON r.id =
          ur.role_id

      WHERE
        u.id = $1

        AND
        u.company_id = $2

        AND
        u.status = 'active'

        AND
        r.name = 'ipcm'

      LIMIT 1;
      `,
      [
        userId,
        companyId
      ]
    );

  const user =
    result.rows[0];

  if (!user) {
    throw new CaseServiceError(
      "INVALID_ASSIGNEE",
      "Case Manager is not an active IPCM user in this company."
    );
  }

  return user;
}

async function validateTravelers(
  client:
    PoolClient,

  companyId:
    string,

  travelerProfileIds:
    string[]
): Promise<string[]> {
  const uniqueTravelerIds =
    normalizeTravelerIds(
      travelerProfileIds
    );

  if (
    uniqueTravelerIds.length ===
    0
  ) {
    throw new CaseServiceError(
      "INVALID_TRAVELER",
      "At least one traveler must be assigned to the case."
    );
  }

  const result =
    await client.query<{
      id: string;
    }>(
      `
      SELECT
        id

      FROM traveler_profiles

      WHERE
        company_id = $1

        AND
        status = 'active'

        AND
        id = ANY(
          $2::uuid[]
        );
      `,
      [
        companyId,
        uniqueTravelerIds
      ]
    );

  if (
    result.rows.length !==
    uniqueTravelerIds.length
  ) {
    throw new CaseServiceError(
      "INVALID_TRAVELER",
      "One or more selected travelers are invalid, inactive, or belong to another company."
    );
  }

  return uniqueTravelerIds;
}

async function replaceCaseTravelers(
  client:
    PoolClient,

  caseId:
    string,

  travelerProfileIds:
    string[]
): Promise<void> {
  await client.query(
    `
    DELETE FROM case_travelers

    WHERE
      case_id = $1;
    `,
    [
      caseId
    ]
  );

  if (
    travelerProfileIds.length ===
    0
  ) {
    return;
  }

  await client.query(
    `
    INSERT INTO case_travelers (
      case_id,
      traveler_profile_id
    )

    SELECT
      $1,
      traveler_profile_id

    FROM UNNEST(
      $2::uuid[]
    )
      AS traveler_profile_id;
    `,
    [
      caseId,
      travelerProfileIds
    ]
  );
}

export async function getCaseFormOptions(
  companyId: string
): Promise<CaseFormOptions> {
  const pool =
    getPool();

  const [
    caseManagersResult,
    travelersResult
  ] =
    await Promise.all([
      pool.query<{
        id: string;

        first_name:
          string;

        last_name:
          string;

        email:
          string;
      }>(
        `
        SELECT DISTINCT
          u.id,
          u.first_name,
          u.last_name,
          u.email

        FROM users u

        JOIN user_roles ur
          ON ur.user_id =
            u.id

        JOIN roles r
          ON r.id =
            ur.role_id

        WHERE
          u.company_id = $1

          AND
          u.status =
            'active'

          AND
          r.name =
            'ipcm'

        ORDER BY
          u.last_name,
          u.first_name,
          u.email;
        `,
        [
          companyId
        ]
      ),

      pool.query<{
        id: string;

        legal_first_name:
          string;

        legal_middle_name:
          string |
          null;

        legal_last_name:
          string;

        email:
          string;
      }>(
        `
        SELECT
          id,
          legal_first_name,
          legal_middle_name,
          legal_last_name,
          email

        FROM traveler_profiles

        WHERE
          company_id = $1

          AND
          status =
            'active'

        ORDER BY
          legal_last_name,
          legal_first_name,
          email;
        `,
        [
          companyId
        ]
      )
    ]);

  return {
    caseManagers:
      caseManagersResult
        .rows
        .map(
          (
            row
          ) => ({
            id:
              row.id,

            firstName:
              row
                .first_name,

            lastName:
              row
                .last_name,

            email:
              row.email
          })
        ),

    travelers:
      travelersResult
        .rows
        .map(
          (
            row
          ) => ({
            id:
              row.id,

            legalFirstName:
              row
                .legal_first_name,

            legalMiddleName:
              row
                .legal_middle_name,

            legalLastName:
              row
                .legal_last_name,

            email:
              row.email
          })
        )
  };
}

export async function createCaseRecord(
  companyId: string,
  input:
    CaseMutationInput
): Promise<CaseMutationResult> {
  const pool =
    getPool();

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const ipcm =
      await getIpcmUser(
        client,
        companyId,
        input.ipcmUserId
      );

    const travelerProfileIds =
      await validateTravelers(
        client,
        companyId,
        input
          .travelerProfileIds
      );

    const result =
      await client.query<{
        id: string;

        case_reference_id:
          string;
      }>(
        `
        INSERT INTO cases (
          case_reference_id,
          ipcm_user_id,
          status,
          company_id,
          suggested_budget_cents
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5
        )

        RETURNING
          id,
          case_reference_id;
        `,
        [
          normalizeReference(
            input
              .caseReferenceId
          ),

          input
            .ipcmUserId,

          normalizeStatus(
            input.status
          ),

          companyId,

          input
            .suggestedBudgetCents
        ]
      );

    const createdCase =
      result.rows[0];

    if (
      !createdCase
    ) {
      throw new CaseServiceError(
        "CREATE_FAILED",
        "The case could not be created."
      );
    }

    await replaceCaseTravelers(
      client,
      createdCase.id,
      travelerProfileIds
    );

    await client.query(
      "COMMIT"
    );

    return {
      id:
        createdCase.id,

      caseReferenceId:
        createdCase
          .case_reference_id,

      ipcmUserId:
        ipcm.id,

      ipcmFirstName:
        ipcm
          .first_name,

      ipcmLastName:
        ipcm
          .last_name,

      ipcmEmail:
        ipcm.email,

      ipcmChanged:
        true
    };
  } catch (
    error
  ) {
    await client.query(
      "ROLLBACK"
    );

    if (
      typeof error ===
        "object" &&
      error !==
        null &&
      "code" in error &&
      error.code ===
        "23505"
    ) {
      throw new CaseServiceError(
        "DUPLICATE_REFERENCE",
        "A case with this case reference already exists."
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function updateCaseRecord(
  companyId: string,
  caseId: string,
  input:
    CaseMutationInput
): Promise<CaseMutationResult> {
  const pool =
    getPool();

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const existingResult =
      await client.query<
        ExistingCaseRow
      >(
        `
        SELECT
          id,
          ipcm_user_id

        FROM cases

        WHERE
          id = $1

          AND
          company_id = $2

        FOR UPDATE;
        `,
        [
          caseId,
          companyId
        ]
      );

    const existing =
      existingResult
        .rows[0];

    if (!existing) {
      throw new CaseServiceError(
        "NOT_FOUND",
        "Case not found."
      );
    }

    const ipcm =
      await getIpcmUser(
        client,
        companyId,
        input.ipcmUserId
      );

    const travelerProfileIds =
      await validateTravelers(
        client,
        companyId,
        input
          .travelerProfileIds
      );

    const ipcmChanged =
      existing.ipcm_user_id !==
      input.ipcmUserId;

    const result =
      await client.query<{
        id: string;

        case_reference_id:
          string;
      }>(
        `
        UPDATE cases

        SET
          case_reference_id =
            $1,

          ipcm_user_id =
            $2,

          suggested_budget_cents =
            $3,

          status =
            $4,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          id = $5

          AND
          company_id = $6

        RETURNING
          id,
          case_reference_id;
        `,
        [
          normalizeReference(
            input
              .caseReferenceId
          ),

          input
            .ipcmUserId,

          input
            .suggestedBudgetCents,

          normalizeStatus(
            input.status
          ),

          caseId,

          companyId
        ]
      );

    const updatedCase =
      result.rows[0];

    if (
      !updatedCase
    ) {
      throw new CaseServiceError(
        "UPDATE_FAILED",
        "The case could not be updated."
      );
    }

    await replaceCaseTravelers(
      client,
      caseId,
      travelerProfileIds
    );

    await client.query(
      "COMMIT"
    );

    return {
      id:
        updatedCase.id,

      caseReferenceId:
        updatedCase
          .case_reference_id,

      ipcmUserId:
        ipcm.id,

      ipcmFirstName:
        ipcm
          .first_name,

      ipcmLastName:
        ipcm
          .last_name,

      ipcmEmail:
        ipcm.email,

      ipcmChanged
    };
  } catch (
    error
  ) {
    await client.query(
      "ROLLBACK"
    );

    if (
      typeof error ===
        "object" &&
      error !==
        null &&
      "code" in error &&
      error.code ===
        "23505"
    ) {
      throw new CaseServiceError(
        "DUPLICATE_REFERENCE",
        "A case with this case reference already exists."
      );
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function updateAssignedIpcmBudget(
  companyId: string,
  ipcmUserId: string,
  caseId: string,
  approvedBudgetCents: number
): Promise<void> {
  const result =
    await getPool()
      .query(
        `
        UPDATE cases

        SET
          approved_budget_cents =
            $1,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          id = $2

          AND
          company_id = $3

          AND
          ipcm_user_id = $4

        RETURNING id;
        `,
        [
          approvedBudgetCents,
          caseId,
          companyId,
          ipcmUserId
        ]
      );

  if (
    result.rowCount ===
    0
  ) {
    throw new CaseServiceError(
      "NOT_FOUND",
      "Case not found or it is not assigned to you."
    );
  }
}