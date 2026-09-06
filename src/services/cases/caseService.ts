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

export type CaseFormOptions = {
  caseManagers:
    CaseAssignmentOption[];

  ipcms:
    CaseAssignmentOption[];
};

export type CaseMutationInput = {
  caseReferenceId:
    string;

  caseManagerUserId:
    string;

  ipcmUserId:
    string;

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

  first_name: string;
  last_name: string;

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

async function getUserWithRole(
  client:
    PoolClient,

  companyId:
    string,

  userId:
    string,

  roleName:
    "case_manager" |
    "ipcm"
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
        r.name = $3

      LIMIT 1;
      `,
      [
        userId,
        companyId,
        roleName
      ]
    );

  const user =
    result.rows[0];

  if (!user) {
    const label =
      roleName ===
      "ipcm"
        ? "IPCM"
        : "Case Manager";

    throw new CaseServiceError(
      "INVALID_ASSIGNEE",
      `${label} is not an active user in this company.`
    );
  }

  return user;
}

export async function getCaseFormOptions(
  companyId: string
): Promise<CaseFormOptions> {
  const result =
    await getPool()
      .query<{
        id: string;

        first_name:
          string;

        last_name:
          string;

        email:
          string;

        role_name:
          string;
      }>(
        `
        SELECT DISTINCT
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          r.name
            AS role_name

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
          r.name IN (
            'case_manager',
            'ipcm'
          )

        ORDER BY
          u.last_name,
          u.first_name,
          u.email;
        `,
        [
          companyId
        ]
      );

  const caseManagers:
    CaseAssignmentOption[] =
      [];

  const ipcms:
    CaseAssignmentOption[] =
      [];

  for (
    const row of
    result.rows
  ) {
    const option:
      CaseAssignmentOption = {
        id:
          row.id,

        firstName:
          row.first_name,

        lastName:
          row.last_name,

        email:
          row.email
      };

    if (
      row.role_name ===
      "case_manager"
    ) {
      caseManagers.push(
        option
      );
    }

    if (
      row.role_name ===
      "ipcm"
    ) {
      ipcms.push(
        option
      );
    }
  }

  return {
    caseManagers,
    ipcms
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

    await getUserWithRole(
      client,
      companyId,
      input
        .caseManagerUserId,
      "case_manager"
    );

    const ipcm =
      await getUserWithRole(
        client,
        companyId,
        input.ipcmUserId,
        "ipcm"
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
          case_manager_user_id,
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
          $5,
          $6
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
            .caseManagerUserId,

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
        ipcm.first_name,

      ipcmLastName:
        ipcm.last_name,

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

    await getUserWithRole(
      client,
      companyId,
      input
        .caseManagerUserId,
      "case_manager"
    );

    const ipcm =
      await getUserWithRole(
        client,
        companyId,
        input.ipcmUserId,
        "ipcm"
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

          case_manager_user_id =
            $2,

          ipcm_user_id =
            $3,

          suggested_budget_cents =
            $4,

          status =
            $5,

          updated_at =
            CURRENT_TIMESTAMP

        WHERE
          id = $6

          AND
          company_id = $7

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
            .caseManagerUserId,

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
        ipcm.first_name,

      ipcmLastName:
        ipcm.last_name,

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