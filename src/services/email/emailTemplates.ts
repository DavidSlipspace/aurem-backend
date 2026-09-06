import type {
  TransactionalEmailRequest
} from "./emailService";

type CaseAssignmentEmailInput = {
  recipientEmail:
    string;

  recipientFirstName:
    string;

  caseReferenceId:
    string;

  suggestedBudgetCents:
    | number
    | null;

  frontendBaseUrl:
    string;
};

function escapeHtml(
  value: string
): string {
  return value
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function formatCurrency(
  cents:
    number
): string {
  return new Intl
    .NumberFormat(
      "en-US",
      {
        style:
          "currency",

        currency:
          "USD"
      }
    )
    .format(
      cents / 100
    );
}

function normalizeBaseUrl(
  value: string
): string {
  return value
    .trim()
    .replace(
      /\/+$/,
      ""
    );
}

export function buildCaseAssignmentEmail(
  input:
    CaseAssignmentEmailInput
): TransactionalEmailRequest {
  const portalUrl =
    normalizeBaseUrl(
      input.frontendBaseUrl
    );

  const suggestedBudgetText =
    input.suggestedBudgetCents ===
    null
      ? "No suggested budget was provided."
      : (
          "Suggested budget: " +
          formatCurrency(
            input
              .suggestedBudgetCents
          )
        );

  const subject =
    `New Aurem case assigned: ${input.caseReferenceId}`;

  const textBody =
    [
      `Hello ${input.recipientFirstName},`,
      "",
      "A new case has been assigned to you in Aurem.",
      "",
      `Case: ${input.caseReferenceId}`,
      suggestedBudgetText,
      "",
      "Please sign in to Aurem to review the case and set the approved case budget.",
      "",
      portalUrl,
      "",
      "Aurem"
    ].join(
      "\n"
    );

  const htmlBody =
    `
      <div
        style="
          font-family:
            Arial,
            Helvetica,
            sans-serif;
          color: #101828;
          line-height: 1.6;
        "
      >
        <p>
          Hello ${escapeHtml(
            input.recipientFirstName
          )},
        </p>

        <p>
          A new case has been
          assigned to you in
          Aurem.
        </p>

        <div
          style="
            padding: 16px;
            margin: 20px 0;
            border: 1px solid #e4e7ec;
            border-radius: 10px;
            background: #f8fafc;
          "
        >
          <strong>
            Case
          </strong>

          <div>
            ${escapeHtml(
              input.caseReferenceId
            )}
          </div>

          <div
            style="
              margin-top: 8px;
              color: #475467;
            "
          >
            ${escapeHtml(
              suggestedBudgetText
            )}
          </div>
        </div>

        <p>
          Please sign in to Aurem
          to review the case and
          set the approved case
          budget.
        </p>

        <p>
          <a
            href="${escapeHtml(
              portalUrl
            )}"
            style="
              display:
                inline-block;
              padding:
                11px 16px;
              border-radius:
                8px;
              background:
                #111827;
              color:
                #ffffff;
              text-decoration:
                none;
              font-weight:
                700;
            "
          >
            Open Aurem
          </a>
        </p>

        <p
          style="
            margin-top: 28px;
            color: #667085;
            font-size: 13px;
          "
        >
          Aurem
        </p>
      </div>
    `;

  return {
    to:
      input.recipientEmail,

    subject,

    textBody,

    htmlBody
  };
}