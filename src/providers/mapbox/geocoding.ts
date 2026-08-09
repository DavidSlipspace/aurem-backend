export type GeocodedDestination = {
  latitude: number;
  longitude: number;
  resolvedDestination: string;
};

type MapboxFeature = {
  geometry?: {
    coordinates?: unknown;
  };

  properties?: {
    full_address?: unknown;
    name?: unknown;
    name_preferred?: unknown;
    place_formatted?: unknown;
  };
};

type MapboxResponse = {
  features?: MapboxFeature[];
  message?: string;
};

const MAPBOX_FORWARD_URL =
  "https://api.mapbox.com/search/geocode/v6/forward";

function getString(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized =
    value.trim();

  return normalized
    ? normalized
    : null;
}

function getNumber(
  value: unknown
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    const parsed =
      Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

async function readMapboxResponse(
  response: Response
): Promise<MapboxResponse> {
  const text =
    await response.text();

  if (!text) {
    throw new Error(
      `Mapbox returned an empty response with status ${response.status}.`
    );
  }

  try {
    return JSON.parse(
      text
    ) as MapboxResponse;
  } catch {
    throw new Error(
      `Mapbox returned invalid JSON with status ${response.status}.`
    );
  }
}

export async function geocodeDestination(
  destination: string,
  accessToken: string
): Promise<GeocodedDestination> {
  const url =
    new URL(
      MAPBOX_FORWARD_URL
    );

  url.searchParams.set(
    "q",
    destination
  );

  url.searchParams.set(
    "access_token",
    accessToken
  );

  url.searchParams.set(
    "limit",
    "1"
  );

  url.searchParams.set(
    "autocomplete",
    "false"
  );

  url.searchParams.set(
    "country",
    "US"
  );

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json"
        },

        signal:
          AbortSignal.timeout(
            8000
          )
      }
    );

  const responseBody =
    await readMapboxResponse(
      response
    );

  if (!response.ok) {
    throw new Error(
      responseBody.message ??
        `Mapbox geocoding failed with status ${response.status}.`
    );
  }

  const feature =
    responseBody.features?.[0];

  const coordinates =
    feature
      ?.geometry
      ?.coordinates;

  if (
    !Array.isArray(
      coordinates
    ) ||
    coordinates.length < 2
  ) {
    throw new Error(
      "Mapbox could not locate the trip destination."
    );
  }

  const longitude =
    getNumber(
      coordinates[0]
    );

  const latitude =
    getNumber(
      coordinates[1]
    );

  if (
    latitude === null ||
    longitude === null
  ) {
    throw new Error(
      "Mapbox returned invalid destination coordinates."
    );
  }

  const fallbackDestination =
    [
      getString(
        feature
          ?.properties
          ?.name_preferred
      ) ??
        getString(
          feature
            ?.properties
            ?.name
        ),

      getString(
        feature
          ?.properties
          ?.place_formatted
      )
    ]
      .filter(
        (
          value
        ): value is string =>
          value !== null
      )
      .join(", ");

  const resolvedDestination =
    getString(
      feature
        ?.properties
        ?.full_address
    ) ??
    (
      fallbackDestination ||
      destination
    );

  return {
    latitude,
    longitude,
    resolvedDestination
  };
}