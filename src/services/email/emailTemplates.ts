import { emailLayout, emailParagraph, emailButton, emailDetail, escapeHtml } from "./emailLayout";

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
    `New Orvo case assigned: ${input.caseReferenceId}`;

  const textBody =
    [
      `Hello ${input.recipientFirstName},`,
      "",
      "A new case has been assigned to you in Orvo.",
      "",
      `Case: ${input.caseReferenceId}`,
      suggestedBudgetText,
      "",
      "Please sign in to Orvo to review the case and set the approved case budget.",
      "",
      portalUrl,
      "",
      "Orvo"
    ].join(
      "\n"
    );

  const htmlBody = emailLayout({
    category: "Case assignment",
    title: "New case assigned",
    bodyHtml: emailParagraph(`Hello ${escapeHtml(input.recipientFirstName)},`) +
      emailParagraph("A new case has been assigned to you in Orvo.") +
      emailDetail("Case", input.caseReferenceId, suggestedBudgetText) +
      emailParagraph("Please sign in to Orvo to review the case and set the approved case budget.") +
      emailButton("Open Orvo", portalUrl)
  });

  return {
    to:
      input.recipientEmail,

    subject,

    textBody,

    htmlBody
  };
}