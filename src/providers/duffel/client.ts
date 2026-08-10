const DUFFEL_API_BASE_URL =
  "https://api.duffel.com";

export class DuffelApiError extends Error {
  statusCode: number;
  responseBody: string;

  constructor(
    message: string,
    statusCode: number,
    responseBody: string
  ) {
    super(message);

    this.name = "DuffelApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

type DuffelRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMilliseconds?: number;
};

function getProviderErrorMessage(
  responseBody: string,
  statusCode: number
): string {
  if (!responseBody.trim()) {
    return `Duffel returned status ${statusCode}.`;
  }

  try {
    const parsed = JSON.parse(
      responseBody
    ) as {
      errors?: Array<{
        title?: string;
        message?: string;
        code?: string;
      }>;
    };

    const messages =
      parsed.errors
        ?.map((error) => {
          return (
            error.message?.trim() ||
            error.title?.trim() ||
            error.code?.trim()
          );
        })
        .filter(
          (value): value is string =>
            Boolean(value)
        ) ?? [];

    if (messages.length > 0) {
      return messages.join("; ");
    }
  } catch {
    // Duffel normally returns JSON, but preserving
    // a readable non-JSON response is useful when
    // diagnosing gateway or access failures.
  }

  const normalized =
    responseBody
      .replace(/\s+/g, " ")
      .trim();

  return normalized.length > 300
    ? `${normalized.substring(0, 300)}...`
    : normalized;
}

export async function duffelRequest<T>(
  path: string,
  accessToken: string,
  options: DuffelRequestOptions = {}
): Promise<T> {
  const method =
    options.method ?? "GET";

  const timeoutMilliseconds =
    options.timeoutMilliseconds ??
    20000;

  const headers: Record<
    string,
    string
  > = {
    Accept: "application/json",
    "Accept-Encoding": "gzip",
    "Duffel-Version": "v2",
    Authorization:
      `Bearer ${accessToken}`
  };

  if (
    options.body !== undefined
  ) {
    headers["Content-Type"] =
      "application/json";
  }

  const response = await fetch(
    `${DUFFEL_API_BASE_URL}${path}`,
    {
      method,
      headers,

      ...(options.body !== undefined
        ? {
            body: JSON.stringify(
              options.body
            )
          }
        : {}),

      signal:
        AbortSignal.timeout(
          timeoutMilliseconds
        )
    }
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    const message =
      getProviderErrorMessage(
        responseText,
        response.status
      );

    throw new DuffelApiError(
      message ||
        `Duffel returned status ${response.status}.`,
      response.status,
      responseText
    );
  }

  if (!responseText) {
    throw new DuffelApiError(
      "Duffel returned an empty response.",
      response.status,
      ""
    );
  }

  try {
    return JSON.parse(
      responseText
    ) as T;
  } catch {
    throw new DuffelApiError(
      "Duffel returned invalid JSON.",
      response.status,
      responseText
    );
  }
}