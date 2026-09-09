import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult
} from "aws-lambda";

import {
  getPool
} from "../db/pool";

import {
  getCurrentUser
} from "../common/currentUser";

import {
  jsonResponse
} from "../common/response";

type CaseRow = {
  id: string;

  case_reference_id:
    string;

  case_manager_user_id:
    string;

  case_manager_first_name:
    string;

  case_manager_last_name:
    string;

  traveler_profile_ids:
    string[];

  traveler_names:
    string[];

  suggested_budget_cents:
    number |
    null;

  approved_budget_cents:
    number |
    null;

  status: string;
};

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
            "Authenticated user does not exist in Aurem database."
        }
      );
    }

    let whereClause =
      "";

    const params:
      string[] =
        [];

    if (
      currentUser
        .roleName ===
      "admin"
    ) {
      whereClause =
        "c.company_id = $1";

      params.push(
        currentUser
          .companyId
      );
    } else if (
      currentUser
        .roleName ===
      "ipcm"
    ) {
      whereClause =
        `
        c.ipcm_user_id = $1
        AND c.company_id = $2
        `;

      params.push(
        currentUser.id,
        currentUser
          .companyId
      );
    } else {
      return jsonResponse(
        403,
        {
          message:
            "User role is not authorized to view cases."
        }
      );
    }

    const result =
      await getPool()
        .query<
          CaseRow
        >(
          `
          SELECT
            c.id,

            c.case_reference_id,

            c.ipcm_user_id
              AS case_manager_user_id,

            ipcm.first_name
              AS case_manager_first_name,

            ipcm.last_name
              AS case_manager_last_name,

            COALESCE(
              ARRAY_AGG(
                tp.id::text
                ORDER BY
                  tp.legal_last_name,
                  tp.legal_first_name
              )
              FILTER (
                WHERE
                  tp.id IS NOT NULL
              ),
              ARRAY[]::text[]
            )
              AS traveler_profile_ids,

            COALESCE(
              ARRAY_AGG(
                TRIM(
                  CONCAT(
                    tp.legal_first_name,
                    ' ',
                    tp.legal_last_name
                  )
                )
                ORDER BY
                  tp.legal_last_name,
                  tp.legal_first_name
              )
              FILTER (
                WHERE
                  tp.id IS NOT NULL
              ),
              ARRAY[]::text[]
            )
              AS traveler_names,

            c.suggested_budget_cents,

            c.approved_budget_cents,

            c.status

          FROM cases c

          JOIN users ipcm
            ON ipcm.id =
              c.ipcm_user_id

          LEFT JOIN case_travelers ct
            ON ct.case_id =
              c.id

          LEFT JOIN traveler_profiles tp
            ON tp.id =
              ct.traveler_profile_id

          WHERE
            ${whereClause}

          GROUP BY
            c.id,
            c.case_reference_id,
            c.ipcm_user_id,
            ipcm.first_name,
            ipcm.last_name,
            c.suggested_budget_cents,
            c.approved_budget_cents,
            c.status,
            c.created_at

          ORDER BY
            c.created_at DESC;
          `,
          params
        );

    return jsonResponse(
      200,
      {
        cases:
          result.rows.map(
            (
              row
            ) => ({
              id:
                row.id,

              caseReferenceId:
                row
                  .case_reference_id,

              caseManagerUserId:
                row
                  .case_manager_user_id,

              caseManagerName:
                `${row.case_manager_first_name} ${row.case_manager_last_name}`
                  .trim(),

              travelerProfileIds:
                row
                  .traveler_profile_ids,

              travelerNames:
                row
                  .traveler_names,

              suggestedBudgetCents:
                row
                  .suggested_budget_cents ===
                null
                  ? null
                  : Number(
                      row
                        .suggested_budget_cents
                    ),

              approvedBudgetCents:
                row
                  .approved_budget_cents ===
                null
                  ? null
                  : Number(
                      row
                        .approved_budget_cents
                    ),

              status:
                row.status
            })
          )
      }
    );
  } catch (
    error
  ) {
    console.error(
      "GET /cases error",
      error
    );

    return jsonResponse(
      500,
      {
        message:
          "Unable to load cases."
      }
    );
  }
}