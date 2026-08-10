import type {
  HotelOption,
  HotelProviderRequest,
  HotelProviderResult
} from "../../types/hotel";

import {
  duffelRequest
} from "./client";

import {
  geocodeDestination
} from "../mapbox/geocoding";

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

  photos?:
    | DuffelPhoto[]
    | null;

  amenities?:
    | DuffelAmenity[]
    | null;

  supported_loyalty_programme?:
    unknown;

  location?: {
    address?: DuffelAddress;

    geographic_coordinates?:
      DuffelCoordinates;
  };
};

type DuffelSearchResult = {
  id?: unknown;
  expires_at?: unknown;

  cheapest_rate_total_amount?:
    unknown;

  cheapest_rate_currency?:
    unknown;

  accommodation?:
    DuffelAccommodation;
};

type DuffelSearchResponse = {
  data?: {
    results?:
      DuffelSearchResult[];
  };
};

function isRecord(
  value: unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function isHotelProviderRequest(
  value: unknown
): value is HotelProviderRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.destination ===
      "string" &&
    value.destination
      .trim()
      .length > 0 &&

    typeof value.checkInDate ===
      "string" &&

    typeof value.checkOutDate ===
      "string" &&

    typeof value.adultGuests ===
      "number" &&

    Number.isInteger(
      value.adultGuests
    ) &&

    value.adultGuests >= 1 &&

    typeof value.rooms ===
      "number" &&

    Number.isInteger(
      value.rooms
    ) &&

    value.rooms >= 1 &&

    typeof value.radiusKilometers ===
      "number" &&

    Number.isFinite(
      value.radiusKilometers
    ) &&

    value.radiusKilometers >= 1 &&

    value.radiusKilometers <= 100 &&

    (
      value.minimumStarRating ===
        undefined ||

      (
        typeof value.minimumStarRating ===
          "number" &&

        Number.isInteger(
          value.minimumStarRating
        ) &&

        value.minimumStarRating >=
          1 &&

        value.minimumStarRating <=
          5
      )
    ) &&

    typeof value.hotelBudgetCents ===
      "number" &&

    Number.isInteger(
      value.hotelBudgetCents
    ) &&

    value.hotelBudgetCents > 0 &&

    typeof value.currency ===
      "string" &&

    value.currency
      .trim()
      .length === 3 &&

    typeof value.maximumResults ===
      "number" &&

    Number.isInteger(
      value.maximumResults
    ) &&

    value.maximumResults >= 1 &&

    value.maximumResults <= 20
  );
}

function getString(
  value: unknown
): string | null {
  if (
    typeof value !== "string"
  ) {
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
    typeof value === "string" &&
    value.trim()
  ) {
    const parsed =
      Number(value);

    if (
      Number.isFinite(parsed)
    ) {
      return parsed;
    }
  }

  return null;
}

function amountToCents(
  value: unknown
): number | null {
  const amount =
    getNumber(value);

  if (amount === null) {
    return null;
  }

  return Math.round(
    amount * 100
  );
}

function toRadians(
  value: number
): number {
  return (
    value *
    (Math.PI / 180)
  );
}

function calculateDistanceMiles(
  originLatitude: number,
  originLongitude: number,
  destinationLatitude: number,
  destinationLongitude: number
): number {
  const earthRadiusMiles =
    3958.7613;

  const latitudeDifference =
    toRadians(
      destinationLatitude -
        originLatitude
    );

  const longitudeDifference =
    toRadians(
      destinationLongitude -
        originLongitude
    );

  const originLatitudeRadians =
    toRadians(
      originLatitude
    );

  const destinationLatitudeRadians =
    toRadians(
      destinationLatitude
    );

  const haversine =
    Math.sin(
      latitudeDifference / 2
    ) ** 2 +

    Math.cos(
      originLatitudeRadians
    ) *

    Math.cos(
      destinationLatitudeRadians
    ) *

    Math.sin(
      longitudeDifference / 2
    ) ** 2;

  const angularDistance =
    2 *
    Math.atan2(
      Math.sqrt(haversine),
      Math.sqrt(
        1 - haversine
      )
    );

  return (
    earthRadiusMiles *
    angularDistance
  );
}

function formatAddress(
  address:
    | DuffelAddress
    | undefined
): {
  fullAddress: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
} {
  const lineOne =
    getString(
      address?.line_one
    );

  const city =
    getString(
      address?.city_name
    ) ?? "";

  const region =
    getString(
      address?.region
    );

  const postalCode =
    getString(
      address?.postal_code
    );

  const countryCode =
    getString(
      address?.country_code
    );

  const fullAddress =
    [
      lineOne,
      city,
      region,
      postalCode,
      countryCode
    ]
      .filter(
        (
          value
        ): value is string =>
          Boolean(value)
      )
      .join(", ");

  return {
    fullAddress:
      fullAddress ||
      "Address unavailable",

    city,
    region,
    postalCode,
    countryCode
  };
}

function normalizeAmenities(
  amenities:
    | DuffelAmenity[]
    | null
    | undefined
): string[] {
  if (
    !Array.isArray(
      amenities
    )
  ) {
    return [];
  }

  const normalized =
    amenities
      .map(
        (amenity) =>
          getString(
            amenity.description
          ) ??
          getString(
            amenity.type
          )
      )
      .filter(
        (
          value
        ): value is string =>
          value !== null
      );

  return Array.from(
    new Set(normalized)
  ).slice(0, 6);
}

function getPhotoUrl(
  photos:
    | DuffelPhoto[]
    | null
    | undefined
): string | null {
  if (!Array.isArray(photos)) {
    return null;
  }

  for (
    const photo of photos
  ) {
    const url =
      getString(photo.url);

    if (url) {
      return url;
    }
  }

  return null;
}

function normalizeHotel(
  result: DuffelSearchResult,
  request: HotelProviderRequest,
  destinationLatitude: number,
  destinationLongitude: number
): HotelOption | null {
  const searchResultId =
    getString(result.id);

  const accommodation =
    result.accommodation;

  const accommodationId =
    getString(
      accommodation?.id
    );

  const name =
    getString(
      accommodation?.name
    );

  const totalAmountCents =
    amountToCents(
      result
        .cheapest_rate_total_amount
    );

  const currency =
    getString(
      result
        .cheapest_rate_currency
    )?.toUpperCase() ??
    null;

  if (
    !searchResultId ||
    !accommodationId ||
    !name ||
    totalAmountCents === null ||
    !currency
  ) {
    return null;
  }

  const starRating =
    getNumber(
      accommodation?.rating
    );

  if (
    request.minimumStarRating !==
      undefined &&

    (
      starRating === null ||
      starRating <
        request.minimumStarRating
    )
  ) {
    return null;
  }

  const reviewScore =
    getNumber(
      accommodation
        ?.review_score
    );

  const reviewCount =
    getNumber(
      accommodation
        ?.review_count
    );

  const latitude =
    getNumber(
      accommodation
        ?.location
        ?.geographic_coordinates
        ?.latitude
    );

  const longitude =
    getNumber(
      accommodation
        ?.location
        ?.geographic_coordinates
        ?.longitude
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

  const address =
    formatAddress(
      accommodation
        ?.location
        ?.address
    );

  return {
    searchResultId,
    accommodationId,

    name,

    description:
      getString(
        accommodation
          ?.description
      ),

    address:
      address.fullAddress,

    city:
      address.city,

    region:
      address.region,

    postalCode:
      address.postalCode,

    countryCode:
      address.countryCode,

    latitude,
    longitude,

    distanceFromDestinationMiles:
      distanceMiles === null
        ? null
        : Number(
            distanceMiles.toFixed(
              1
            )
          ),

    starRating:
      starRating === null
        ? null
        : Math.floor(
            starRating
          ),

    reviewScore,
    reviewCount,

    cheapestTotalAmountCents:
      totalAmountCents,

    currency,

    photoUrl:
      getPhotoUrl(
        accommodation?.photos
      ),

    amenities:
      normalizeAmenities(
        accommodation?.amenities
      ),

    loyaltyProgram:
      getString(
        accommodation
          ?.supported_loyalty_programme
      ),

    expiresAt:
      getString(
        result.expires_at
      ),

    isWithinBudget:
      currency ===
        request.currency
          .toUpperCase() &&

      totalAmountCents <=
        request.hotelBudgetCents
  };
}

function rankHotels(
  hotels: HotelOption[]
): HotelOption[] {
  return [...hotels].sort(
    (
      first,
      second
    ) => {
      if (
        first.isWithinBudget !==
        second.isWithinBudget
      ) {
        return first.isWithinBudget
          ? -1
          : 1;
      }

      if (
        first
          .cheapestTotalAmountCents !==
        second
          .cheapestTotalAmountCents
      ) {
        return (
          first
            .cheapestTotalAmountCents -
          second
            .cheapestTotalAmountCents
        );
      }

      return (
        (
          second.reviewScore ??
          0
        ) -
        (
          first.reviewScore ??
          0
        )
      );
    }
  );
}

export async function searchStays(
  request: HotelProviderRequest,
  duffelAccessToken: string,
  mapboxAccessToken: string
): Promise<HotelProviderResult> {
  const destination =
    await geocodeDestination(
      request.destination,
      mapboxAccessToken
    );

  const guests =
    Array.from(
      {
        length:
          request.adultGuests
      },

      () => ({
        type: "adult"
      })
    );

  const response =
    await duffelRequest<DuffelSearchResponse>(
      "/stays/search",

      duffelAccessToken,

      {
        method: "POST",

        timeoutMilliseconds:
          18000,

        body: {
          data: {
            rooms:
              request.rooms,

            mobile: false,

            location: {
              radius:
                Math.round(
                  request
                    .radiusKilometers
                ),

              geographic_coordinates:
                {
                  longitude:
                    destination
                      .longitude,

                  latitude:
                    destination
                      .latitude
                }
            },

            guests,

            free_cancellation_only:
              false,

            check_in_date:
              request.checkInDate,

            check_out_date:
              request.checkOutDate
          }
        }
      }
    );

  const providerResults =
    Array.isArray(
      response.data?.results
    )
      ? response.data!.results!
      : [];

  const hotels =
    providerResults
      .map((result) =>
        normalizeHotel(
          result,
          request,
          destination.latitude,
          destination.longitude
        )
      )
      .filter(
        (
          hotel
        ): hotel is HotelOption =>
          hotel !== null
      );

  return {
    destination:
      request.destination,

    resolvedDestination:
      destination
        .resolvedDestination,

    destinationLatitude:
      destination.latitude,

    destinationLongitude:
      destination.longitude,

    checkInDate:
      request.checkInDate,

    checkOutDate:
      request.checkOutDate,

    adultGuests:
      request.adultGuests,

    rooms:
      request.rooms,

    radiusKilometers:
      request.radiusKilometers,

    minimumStarRating:
      request.minimumStarRating ??
      null,

    hotelBudgetCents:
      request.hotelBudgetCents,

    currency:
      request.currency
        .toUpperCase(),

    hotels:
      rankHotels(
        hotels
      ).slice(
        0,
        request.maximumResults
      )
  };
}