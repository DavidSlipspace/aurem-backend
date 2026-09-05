type CreateComponentKeyRequest = {
  action:
    "create_component_key";
};

type DeleteCardRequest = {
  action:
    "delete_card";

  cardId:
    string;
};

type PaymentProviderRequest =
  | CreateComponentKeyRequest
  | DeleteCardRequest;

type DuffelComponentKeyResponse = {
  data?: {
    component_client_key?:
      string;
  };
};

function isPaymentProviderRequest(
  value:
    unknown
): value is PaymentProviderRequest {
  if (
    !value ||
    typeof value !==
      "object"
  ) {
    return false;
  }

  const request =
    value as
      Partial<PaymentProviderRequest>;

  if (
    request.action ===
    "create_component_key"
  ) {
    return true;
  }

  return (
    request.action ===
      "delete_card" &&
    "cardId" in request &&
    typeof request.cardId ===
      "string" &&
    request.cardId.trim()
      .length >
      0
  );
}

function getDuffelErrorMessage(
  responseBody:
    string,
  statusCode:
    number
): string {
  if (
    !responseBody.trim()
  ) {
    return (
      `Duffel returned status ${statusCode}.`
    );
  }

  try {
    const parsed =
      JSON.parse(
        responseBody
      ) as {
        errors?: Array<{
          message?:
            string;

          title?:
            string;

          code?:
            string;
        }>;
      };

    const messages =
      parsed.errors
        ?.map(
          (
            error
          ) =>
            error.message?.trim() ||
            error.title?.trim() ||
            error.code?.trim()
        )
        .filter(
          (
            value
          ): value is string =>
            Boolean(
              value
            )
        ) ?? [];

    if (
      messages.length >
      0
    ) {
      return messages.join(
        "; "
      );
    }
  } catch {
    // Preserve readable
    // non-JSON error below.
  }

  const normalized =
    responseBody
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  return normalized
    .substring(
      0,
      400
    );
}

async function duffelRequest(
  url:
    string,
  accessToken:
    string,
  options: {
    method:
      "POST" |
      "DELETE";

    body?:
      unknown;
  }
): Promise<unknown> {
  const response =
    await fetch(
      url,
      {
        method:
          options.method,

        headers: {
          Accept:
            "application/json",

          "Accept-Encoding":
            "gzip",

          "Duffel-Version":
            "v2",

          Authorization:
            `Bearer ${accessToken}`,

          ...(options.body !==
          undefined
            ? {
                "Content-Type":
                  "application/json"
              }
            : {})
        },

        ...(options.body !==
        undefined
          ? {
              body:
                JSON.stringify(
                  options.body
                )
            }
          : {}),

        signal:
          AbortSignal.timeout(
            20000
          )
      }
    );

  const responseText =
    await response.text();

  if (
    !response.ok
  ) {
    throw new Error(
      getDuffelErrorMessage(
        responseText,
        response.status
      )
    );
  }

  if (
    !responseText
  ) {
    return {};
  }

  return JSON.parse(
    responseText
  ) as unknown;
}

export async function handler(
  event:
    unknown
): Promise<unknown> {
  if (
    !isPaymentProviderRequest(
      event
    )
  ) {
    throw new Error(
      "Payment provider received an invalid request."
    );
  }

  const accessToken =
    process.env
      .DUFFEL_ACCESS_TOKEN;

  if (
    !accessToken
  ) {
    throw new Error(
      "DUFFEL_ACCESS_TOKEN is not configured."
    );
  }

  if (
    event.action ===
    "create_component_key"
  ) {
    const response =
      await duffelRequest(
        "https://api.duffel.com/identity/component_client_keys",
        accessToken,
        {
          method:
            "POST",

          body: {
            data: {}
          }
        }
      ) as
        DuffelComponentKeyResponse;

    const key =
      response.data
        ?.component_client_key;

    if (
      !key
    ) {
      throw new Error(
        "Duffel did not return a component client key."
      );
    }

    return {
      componentClientKey:
        key
    };
  }

  await duffelRequest(
    `https://api.duffel.cards/payments/cards/${encodeURIComponent(
      event.cardId
    )}`,
    accessToken,
    {
      method:
        "DELETE"
    }
  );

  return {
    deleted:
      true
  };
}