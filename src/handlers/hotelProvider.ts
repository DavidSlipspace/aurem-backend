import type {
  HotelOption,
  HotelProviderRequest,
  HotelProviderResult
} from "../types/hotel";

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

type DuffelAmenity = {
  type?: unknown;
  description?: unknown;
};

type DuffelPhoto = {
  url?: unknown;
};

type DuffelAddress = {
  line_one?: unknown;
  city_name?: unknown;
  region?: unknown;
  postal_code?: unknown;
  country_code?: unknown;
};

type DuffelCoordinates = {
  latitude?: unknown;
  longitude?: unknown;
};

type DuffelAccommodation = {
  id?: unknown;
  name?: unknown;
  description?: unknown;

  rating?: unknown;
  review_score?: unknown;
  review_count?: unknown;

  photos?: DuffelPhoto[] | null;
  amenities?: DuffelAmenity[] | null;

  supported_loyalty_programme?: unknown;

  location?: {
    address?: DuffelAddress;
    geographic_coordinates?: DuffelCoordinates;
  };
};

type DuffelSearchResult = {
  id?: unknown;
  expires_at?: unknown;

  cheapest_rate_total_amount?: unknown;
  cheapest_rate_currency?: unknown;

  accommodation?: DuffelAccommodation;
};

type DuffelSearchResponse = {
  data?: {
    results?: DuffelSearchResult[];
  };

  errors?: Array<{
    title?: string;
    message?: string;
  }>;
};

type GeocodedDestination = {
  latitude: number;
  longitude: number;
  resolvedDestination: string;
};

const MAPBOX_FORWARD_URL =
  "https://api.mapbox.com/search/geocode/v6/forward";

const DUFFEL_STAYS_SEARCH_URL =
  "https://api.duffel.com/stays/search";

const MILES_PER_KILOMETER = 0.621371;

function getErrorDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: "UnknownError",
    message: String(error)
  };
}

function isRecord(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isHotelProviderRequest(
  value: unknown
): value is HotelProviderRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.destination === "string" &&
    value.destination.trim().length > 0 &&
    typeof value.checkInDate === "string" &&
    value.checkInDate.length > 0 &&
    typeof value.checkOutDate === "string" &&
    value.checkOutDate.length > 0 &&
    typeof value.adultGuests === "number" &&
    Number.isInteger(value.adultGuests) &&
    value.adultGuests >= 1 &&
    typeof value.rooms === "number" &&
    Number.isInteger(value.rooms) &&
    value.rooms >= 1 &&
    typeof value.radiusKilometers === "number" &&
    Number.isFinite(value.radiusKilometers) &&
    value.radiusKilometers >= 1 &&
    value.radiusKilometers <= 100 &&
    (
      value.minimumStarRating === undefined ||
      (
        typeof value.minimumStarRating === "number" &&
        Number.isInteger(value.minimumStarRating) &&
        value.minimumStarRating >= 1 &&
        value.minimumStarRating <= 5
      )
    ) &&
    typeof value.hotelBudgetCents === "number" &&
    Number.isInteger(value.hotelBudgetCents) &&
    value.hotelBudgetCents > 0 &&
    typeof value.currency === "string" &&
    value.currency.trim().length === 3 &&
    typeof value.maximumResults === "number" &&
    Number.isInteger(value.maximumResults) &&
    value.maximumResults >= 1 &&
    value.maximumResults <= 20
  );
}

function getString(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0
    ? normalized
    : null;
}

function getFiniteNumber(
  value: unknown
): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim().length > 0
  ) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function convertAmountToCents(
  value: unknown
): number | null {
  const numericValue = getFiniteNumber(value);

  if (numericValue === null) {
    return null;
  }

  return Math.round(numericValue * 100);
}

function toRadians(value: number): number {
  return value * (Math.PI / 180);
}

function calculateDistanceMiles(
  originLatitude: number,
  originLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number
): number {
  const earthRadiusMiles = 3958.7613;

  const latitudeDifference = toRadians(
    destinationLatitude - originLatitude
  );

  const longitudeDifference = toRadians(
    destinationLongitude - originLongitude
  );

  const originLatitudeRadians =
    toRadians(originLatitude);

  const destinationLatitudeRadians =
    toRadians(destinationLatitude);

  const haversine =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(originLatitudeRadians) *
      Math.cos(destinationLatitudeRadians) *
      Math.sin(longitudeDifference / 2) ** 2;

  const angularDistance =
    2 *
    Math.atan2(
      Math.sqrt(haversine),
      Math.sqrt(1 - haversine)
    );

  return earthRadiusMiles * angularDistance;
}

function formatAddress(
  address: DuffelAddress | undefined
): {
  fullAddress: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
} {
  const lineOne = getString(address?.line_one);
  const city = getString(address?.city_name) ?? "";
  const region = getString(address?.region);
  const postalCode = getString(
    address?.postal_code
  );
  const countryCode = getString(
    address?.country_code
  );

  const fullAddress = [
    lineOne,
    city,
    region,
    postalCode,
    countryCode
  ]
    .filter(
      (value): value is string =>
        typeof value === "string" &&
        value.length > 0
    )
    .join(", ");

  return {
    fullAddress:
      fullAddress || "Address unavailable",
    city,
    region,
    postalCode,
    countryCode
  };
}

function normalizeAmenities(
  amenities: DuffelAmenity[] | null | undefined
): string[] {
  if (!Array.isArray(amenities)) {
    return [];
  }

  const normalized = amenities
    .map((amenity) => {
      return (
        getString(amenity.description) ??
        getString(amenity.type)
      );
    })
    .filter(
      (value): value is string =>
        value !== null
    );

  return Array.from(new Set(normalized)).slice(
    0,
    6
  );
}

function getPrimaryPhotoUrl(
  photos: DuffelPhoto[] | null | undefined
): string | null {
  if (!Array.isArray(photos)) {
    return null;
  }

  for (const photo of photos) {
    const url = getString(photo.url);

    if (url) {
      return url;
    }
  }

  return null;
}

async function parseJsonResponse<T>(
  response: Response
): Promise<T> {
  const responseText = await response.text();

  if (!responseText) {
    throw new Error(
      `Remote service returned an empty response with status ${response.status}.`
    );
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    throw new Error(
      `Remote service returned invalid JSON with status ${response.status}.`
    );
  }
}

async function geocodeDestination(
  destination: string,
  mapboxAccessToken: string
): Promise<GeocodedDestination> {
  const url = new URL(MAPBOX_FORWARD_URL);

  url.searchParams.set("q", destination);
  url.searchParams.set(
    "access_token",
    mapboxAccessToken
  );
  url.searchParams.set("limit", "1");
  url.searchParams.set("autocomplete", "false");
  url.searchParams.set("country", "US");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(8000)
  });

  const responseBody =
    await parseJsonResponse<MapboxResponse>(
      response
    );

  if (!response.ok) {
    throw new Error(
      responseBody.message ??
        `Mapbox geocoding failed with status ${response.status}.`
    );
  }

  const feature = responseBody.features?.[0];

  const coordinates =
    feature?.geometry?.coordinates;

  if (
    !Array.isArray(coordinates) ||
    coordinates.length < 2
  ) {
    throw new Error(
      "Mapbox could not locate the trip destination."
    );
  }

  const longitude = getFiniteNumber(
    coordinates[0]
  );

  const latitude = getFiniteNumber(
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

  const resolvedDestination =
    getString(feature?.properties?.full_address) ??
    [
      getString(
        feature?.properties?.name_preferred
      ) ??
        getString(feature?.properties?.name),
      getString(
        feature?.properties?.place_formatted
      )
    ]
      .filter(
        (value): value is string =>
          value !== null
      )
      .join(", ") ||
    destination;

  return {
    latitude,
    longitude,
    resolvedDestination
  };
}

async function searchDuffelHotels(
  request: HotelProviderRequest,
  geocodedDestination: GeocodedDestination,
  duffelAccessToken: string
): Promise<DuffelSearchResult[]> {
  const guests = Array.from(
    {
      length: request.adultGuests
    },
    () => ({
      type: "adult"
    })
  );

  const response = await fetch(
    DUFFEL_STAYS_SEARCH_URL,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "Duffel-Version": "v2",
        Authorization:
          `Bearer ${duffelAccessToken}`
      },
      body: JSON.stringify({
        data: {
          rooms: request.rooms,
          mobile: false,
          location: {
            radius: Math.round(
              request.radiusKilometers
            ),
            geographic_coordinates: {
              longitude:
                geocodedDestination.longitude,
              latitude:
                geocodedDestination.latitude
            }
          },
          guests,
          free_cancellation_only: false,
          check_in_date: request.checkInDate,
          check_out_date: request.checkOutDate
        }
      }),
      signal: AbortSignal.timeout(18000)
    }
  );

  const responseBody =
    await parseJsonResponse<DuffelSearchResponse>(
      response
    );

  if (!response.ok) {
    const providerMessage =
      responseBody.errors
        ?.map((error) => {
          return (
            getString(error.message) ??
            getString(error.title)
          );
        })
        .filter(
          (value): value is string =>
            value !== null
        )
        .join("; ");

    throw new Error(
      providerMessage ||
        `Duffel hotel search failed with status ${response.status}.`
    );
  }

  return Array.isArray(
    responseBody.data?.results
  )
    ? responseBody.data.results
    : [];
}

function normalizeHotelOption(
  result: DuffelSearchResult,
  request: HotelProviderRequest,
  destinationLatitude: number,
  destinationLongitude: number
): HotelOption | null {
  const searchResultId = getString(result.id);

  const accommodation =
    result.accommodation;

  const accommodationId = getString(
    accommodation?.id
  );

  const name = getString(
    accommodation?.name
  );

  const totalAmountCents =
    convertAmountToCents(
      result.cheapest_rate_total_amount
    );

  const currency =
    getString(
      result.cheapest_rate_currency
    )?.toUpperCase() ?? null;

  if (
    !searchResultId ||
    !accommodationId ||
    !name ||
    totalAmountCents === null ||
    !currency
  ) {
    return null;
  }

  const starRating = getFiniteNumber(
    accommodation?.rating
  );

  if (
    request.minimumStarRating !== undefined &&
    (
      starRating === null ||
      starRating <
        request.minimumStarRating
    )
  ) {
    return null;
  }

  const reviewScore = getFiniteNumber(
    accommodation?.review_score
  );

  const reviewCount = getFiniteNumber(
    accommodation?.review_count
  );

  const latitude = getFiniteNumber(
    accommodation?.location
      ?.geographic_coordinates?.latitude
  );

  const longitude = getFiniteNumber(
    accommodation?.location
      ?.geographic_coordinates?.longitude
  );

  const distanceMiles =
    latitude !== null &&
    longitude !== null
      ? calculateDistanceMiles(
          destinationLatitude,
          destinationLongitude,
          latitude,
          longitude
        )
      : null;

  const formattedAddress = formatAddress(
    accommodation?.location?.address
  );

  return {
    searchResultId,
    accommodationId,

    name,
    description:
      getString(accommodation?.description),

    address: formattedAddress.fullAddress,
    city: formattedAddress.city,
    region: formattedAddress.region,
    postalCode: formattedAddress.postalCode,
    countryCode:
      formattedAddress.countryCode,

    latitude,
    longitude,
    distanceFromDestinationMiles:
      distanceMiles === null
        ? null
        : Number(distanceMiles.toFixed(1)),

    starRating:
      starRating === null
        ? null
        : Math.floor(starRating),

    reviewScore,
    reviewCount,

    cheapestTotalAmountCents:
      totalAmountCents,

    currency,

    photoUrl: getPrimaryPhotoUrl(
      accommodation?.photos
    ),

    amenities: normalizeAmenities(
      accommodation?.amenities
    ),

    loyaltyProgram:
      getString(
        accommodation
          ?.supported_loyalty_programme
      ),

    expiresAt:
      getString(result.expires_at),

    isWithinBudget:
      currency ===
        request.currency.toUpperCase() &&
      totalAmountCents <=
        request.hotelBudgetCents
  };
}

function rankHotelOptions(
  hotels: HotelOption[]
): HotelOption[] {
  return [...hotels].sort(
    (first, second) => {
      if (
        first.isWithinBudget !==
        second.isWithinBudget
      ) {
        return first.isWithinBudget
          ? -1
          : 1;
      }

      if (
        first.cheapestTotalAmountCents !==
        second.cheapestTotalAmountCents
      ) {
        return (
          first.cheapestTotalAmountCents -
          second.cheapestTotalAmountCents
        );
      }

      return (
        (second.reviewScore ?? 0) -
        (first.reviewScore ?? 0)
      );
    }
  );
}

export async function handler(
  event: unknown
): Promise<HotelProviderResult> {
  console.log(
    "Hotel provider request received"
  );

  if (!isHotelProviderRequest(event)) {
    throw new Error(
      "Hotel provider received an invalid request."
    );
  }

  const duffelAccessToken =
    process.env.DUFFEL_ACCESS_TOKEN;

  const mapboxAccessToken =
    process.env.MAPBOX_ACCESS_TOKEN;

  if (!duffelAccessToken) {
    throw new Error(
      "DUFFEL_ACCESS_TOKEN is not configured."
    );
  }

  if (!mapboxAccessToken) {
    throw new Error(
      "MAPBOX_ACCESS_TOKEN is not configured."
    );
  }

  try {
    const geocodedDestination =
      await geocodeDestination(
        event.destination,
        mapboxAccessToken
      );

    const duffelResults =
      await searchDuffelHotels(
        event,
        geocodedDestination,
        duffelAccessToken
      );

    const normalizedHotels =
      duffelResults
        .map((result) => {
          return normalizeHotelOption(
            result,
            event,
            geocodedDestination.latitude,
            geocodedDestination.longitude
          );
        })
        .filter(
          (
            hotel
          ): hotel is HotelOption =>
            hotel !== null
        );

    const rankedHotels =
      rankHotelOptions(
        normalizedHotels
      ).slice(0, event.maximumResults);

    console.log(
      "Hotel provider search completed",
      {
        destination:
          event.destination,
        resolvedDestination:
          geocodedDestination
            .resolvedDestination,
        providerResultCount:
          duffelResults.length,
        returnedResultCount:
          rankedHotels.length
      }
    );

    return {
      destination: event.destination,

      resolvedDestination:
        geocodedDestination
          .resolvedDestination,

      destinationLatitude:
        geocodedDestination.latitude,

      destinationLongitude:
        geocodedDestination.longitude,

      checkInDate:
        event.checkInDate,

      checkOutDate:
        event.checkOutDate,

      adultGuests:
        event.adultGuests,

      rooms: event.rooms,

      radiusKilometers:
        event.radiusKilometers,

      minimumStarRating:
        event.minimumStarRating ?? null,

      hotelBudgetCents:
        event.hotelBudgetCents,

      currency:
        event.currency.toUpperCase(),

      hotels: rankedHotels
    };
  } catch (error) {
    console.error(
      "Hotel provider failed",
      getErrorDetails(error)
    );

    throw error;
  }
}