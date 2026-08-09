import type {
  FlightJourney,
  FlightOption,
  FlightProviderRequest,
  FlightProviderResult,
  FlightSegment
} from "../../types/flight";

import {
  duffelRequest
} from "./client";

type DuffelPlace = {
  type?: unknown;
  name?: unknown;
  iata_code?: unknown;
  iata_city_code?: unknown;
  city_name?: unknown;
};

type DuffelPlaceResponse = {
  data?: DuffelPlace[];
};

type DuffelCarrier = {
  name?: unknown;
  iata_code?: unknown;
  logo_lockup_url?: unknown;
};

type DuffelAirport = {
  name?: unknown;
  iata_code?: unknown;
};

type DuffelAircraft = {
  name?: unknown;
};

type DuffelSegment = {
  id?: unknown;

  departing_at?: unknown;
  arriving_at?: unknown;

  duration?: unknown;

  origin?: DuffelAirport;
  destination?: DuffelAirport;

  marketing_carrier?:
    DuffelCarrier;

  operating_carrier?:
    DuffelCarrier;

  marketing_carrier_flight_number?:
    unknown;

  operating_carrier_flight_number?:
    unknown;

  aircraft?:
    DuffelAircraft;
};

type DuffelSlice = {
  duration?: unknown;

  segments?:
    DuffelSegment[];
};

type DuffelOffer = {
  id?: unknown;

  total_amount?: unknown;
  total_currency?: unknown;

  expires_at?: unknown;

  owner?: DuffelCarrier;

  slices?:
    DuffelSlice[];
};

type DuffelOfferRequestResponse = {
  data?: {
    offers?: DuffelOffer[];
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

export function isFlightProviderRequest(
  value: unknown
): value is FlightProviderRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.originAirportCode ===
      "string" &&

    /^[A-Za-z]{3}$/.test(
      value.originAirportCode
    ) &&

    typeof value.returnAirportCode ===
      "string" &&

    /^[A-Za-z]{3}$/.test(
      value.returnAirportCode
    ) &&

    typeof value.destinationQuery ===
      "string" &&

    value.destinationQuery
      .trim()
      .length >= 2 &&

    typeof value.outboundDate ===
      "string" &&

    typeof value.returnDate ===
      "string" &&

    typeof value.adultPassengers ===
      "number" &&

    Number.isInteger(
      value.adultPassengers
    ) &&

    value.adultPassengers >= 1 &&

    typeof value.flightBudgetCents ===
      "number" &&

    Number.isInteger(
      value.flightBudgetCents
    ) &&

    value.flightBudgetCents > 0 &&

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

function getAmountCents(
  value: unknown
): number | null {
  const stringValue =
    getString(value);

  if (!stringValue) {
    return null;
  }

  const amount =
    Number(stringValue);

  if (
    !Number.isFinite(amount)
  ) {
    return null;
  }

  return Math.round(
    amount * 100
  );
}

function parseIsoDurationMinutes(
  value: unknown
): number | null {
  const duration =
    getString(value);

  if (!duration) {
    return null;
  }

  const match =
    duration.match(
      /^PT(?:(\d+)H)?(?:(\d+)M)?$/
    );

  if (!match) {
    return null;
  }

  const hours =
    Number(match[1] ?? 0);

  const minutes =
    Number(match[2] ?? 0);

  return (
    hours * 60 +
    minutes
  );
}

function normalizeAirportCode(
  value: string
): string {
  return value
    .trim()
    .toUpperCase();
}

function getPlacePriority(
  place: DuffelPlace,
  query: string
): number {
  const normalizedQuery =
    query
      .trim()
      .toLowerCase();

  const name =
    getString(place.name)
      ?.toLowerCase();

  const cityName =
    getString(
      place.city_name
    )?.toLowerCase();

  const iataCode =
    getString(
      place.iata_code
    )?.toLowerCase();

  if (
    name === normalizedQuery &&
    place.type === "city"
  ) {
    return 0;
  }

  if (
    cityName ===
      normalizedQuery &&
    place.type === "city"
  ) {
    return 1;
  }

  if (
    iataCode ===
    normalizedQuery
  ) {
    return 2;
  }

  if (
    name === normalizedQuery
  ) {
    return 3;
  }

  if (
    cityName ===
    normalizedQuery
  ) {
    return 4;
  }

  return 10;
}

async function resolveDestinationPlace(
  query: string,
  accessToken: string
): Promise<{
  name: string;
  code: string;
}> {
  const encodedQuery =
    encodeURIComponent(
      query.trim()
    );

  const response =
    await duffelRequest<DuffelPlaceResponse>(
      `/places/suggestions?query=${encodedQuery}`,
      accessToken,
      {
        method: "GET",
        timeoutMilliseconds:
          10000
      }
    );

  const places =
    Array.isArray(
      response.data
    )
      ? response.data
      : [];

  const rankedPlaces =
    [...places].sort(
      (
        first,
        second
      ) =>
        getPlacePriority(
          first,
          query
        ) -
        getPlacePriority(
          second,
          query
        )
    );

  const place =
    rankedPlaces.find(
      (candidate) => {
        const code =
          getString(
            candidate.iata_code
          );

        return (
          code !== null &&
          /^[A-Za-z]{3}$/.test(
            code
          )
        );
      }
    );

  if (!place) {
    throw new Error(
      `Duffel could not resolve "${query}" to a flight destination.`
    );
  }

  const code =
    getString(
      place.iata_code
    )!;

  const name =
    getString(
      place.name
    ) ??
    getString(
      place.city_name
    ) ??
    query;

  return {
    name,
    code:
      code.toUpperCase()
  };
}

function normalizeSegment(
  segment: DuffelSegment
): FlightSegment | null {
  const id =
    getString(segment.id);

  const originAirportCode =
    getString(
      segment
        .origin
        ?.iata_code
    );

  const destinationAirportCode =
    getString(
      segment
        .destination
        ?.iata_code
    );

  const departingAt =
    getString(
      segment.departing_at
    );

  const arrivingAt =
    getString(
      segment.arriving_at
    );

  const operatingCarrierName =
    getString(
      segment
        .operating_carrier
        ?.name
    );

  if (
    !id ||
    !originAirportCode ||
    !destinationAirportCode ||
    !departingAt ||
    !arrivingAt ||
    !operatingCarrierName
  ) {
    return null;
  }

  const marketingCarrierName =
    getString(
      segment
        .marketing_carrier
        ?.name
    ) ??
    operatingCarrierName;

  const marketingCarrierCode =
    getString(
      segment
        .marketing_carrier
        ?.iata_code
    );

  const operatingCarrierCode =
    getString(
      segment
        .operating_carrier
        ?.iata_code
    );

  const marketingFlightNumber =
    getString(
      segment
        .marketing_carrier_flight_number
    );

  const operatingFlightNumber =
    getString(
      segment
        .operating_carrier_flight_number
    );

  const flightNumber =
    marketingFlightNumber
      ? `${
          marketingCarrierCode ??
          ""
        }${marketingFlightNumber}`
      : operatingFlightNumber
        ? `${
            operatingCarrierCode ??
            ""
          }${operatingFlightNumber}`
        : "Flight";

  return {
    id,

    originAirportCode:
      originAirportCode
        .toUpperCase(),

    originAirportName:
      getString(
        segment
          .origin
          ?.name
      ) ??
      originAirportCode,

    destinationAirportCode:
      destinationAirportCode
        .toUpperCase(),

    destinationAirportName:
      getString(
        segment
          .destination
          ?.name
      ) ??
      destinationAirportCode,

    departingAt,
    arrivingAt,

    durationMinutes:
      parseIsoDurationMinutes(
        segment.duration
      ),

    marketingCarrierName,

    marketingCarrierCode:
      marketingCarrierCode
        ?.toUpperCase() ??
      null,

    operatingCarrierName,

    operatingCarrierCode:
      operatingCarrierCode
        ?.toUpperCase() ??
      null,

    flightNumber,

    aircraftName:
      getString(
        segment
          .aircraft
          ?.name
      )
  };
}

function normalizeJourney(
  slice:
    | DuffelSlice
    | undefined
): FlightJourney | null {
  if (
    !slice ||
    !Array.isArray(
      slice.segments
    ) ||
    slice.segments.length === 0
  ) {
    return null;
  }

  const segments =
    slice.segments
      .map(
        normalizeSegment
      )
      .filter(
        (
          segment
        ): segment is FlightSegment =>
          segment !== null
      );

  if (
    segments.length === 0
  ) {
    return null;
  }

  const first =
    segments[0];

  const last =
    segments[
      segments.length - 1
    ];

  return {
    originAirportCode:
      first.originAirportCode,

    destinationAirportCode:
      last
        .destinationAirportCode,

    departingAt:
      first.departingAt,

    arrivingAt:
      last.arrivingAt,

    durationMinutes:
      parseIsoDurationMinutes(
        slice.duration
      ),

    stopCount:
      Math.max(
        0,
        segments.length - 1
      ),

    segments
  };
}

function normalizeOffer(
  offer: DuffelOffer,
  request: FlightProviderRequest
): FlightOption | null {
  const offerId =
    getString(offer.id);

  const totalAmountCents =
    getAmountCents(
      offer.total_amount
    );

  const currency =
    getString(
      offer.total_currency
    )?.toUpperCase();

  if (
    !offerId ||
    totalAmountCents === null ||
    !currency ||
    !Array.isArray(
      offer.slices
    ) ||
    offer.slices.length < 2
  ) {
    return null;
  }

  const outbound =
    normalizeJourney(
      offer.slices[0]
    );

  const returnJourney =
    normalizeJourney(
      offer.slices[1]
    );

  if (
    !outbound ||
    !returnJourney
  ) {
    return null;
  }

  return {
    offerId,

    ownerName:
      getString(
        offer.owner?.name
      ) ??
      outbound
        .segments[0]
        .marketingCarrierName,

    ownerCode:
      getString(
        offer
          .owner
          ?.iata_code
      )?.toUpperCase() ??
      null,

    ownerLogoUrl:
      getString(
        offer
          .owner
          ?.logo_lockup_url
      ),

    totalAmountCents,

    currency,

    expiresAt:
      getString(
        offer.expires_at
      ),

    outbound,

    return:
      returnJourney,

    isWithinBudget:
      currency ===
        request.currency
          .toUpperCase() &&

      totalAmountCents <=
        request.flightBudgetCents
  };
}

function totalStops(
  flight: FlightOption
): number {
  return (
    flight.outbound
      .stopCount +
    flight.return
      .stopCount
  );
}

function totalDuration(
  flight: FlightOption
): number {
  return (
    (
      flight.outbound
        .durationMinutes ??
      Number.MAX_SAFE_INTEGER /
        2
    ) +

    (
      flight.return
        .durationMinutes ??
      Number.MAX_SAFE_INTEGER /
        2
    )
  );
}

function rankFlights(
  flights: FlightOption[]
): FlightOption[] {
  return [...flights].sort(
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

      const stopDifference =
        totalStops(first) -
        totalStops(second);

      if (
        stopDifference !== 0
      ) {
        return stopDifference;
      }

      if (
        first
          .totalAmountCents !==
        second
          .totalAmountCents
      ) {
        return (
          first
            .totalAmountCents -
          second
            .totalAmountCents
        );
      }

      return (
        totalDuration(first) -
        totalDuration(second)
      );
    }
  );
}

export async function searchFlights(
  request: FlightProviderRequest,
  accessToken: string
): Promise<FlightProviderResult> {
  const originAirportCode =
    normalizeAirportCode(
      request.originAirportCode
    );

  const returnAirportCode =
    normalizeAirportCode(
      request.returnAirportCode
    );

  const destination =
    await resolveDestinationPlace(
      request.destinationQuery,
      accessToken
    );

  const passengers =
    Array.from(
      {
        length:
          request
            .adultPassengers
      },

      () => ({
        type: "adult"
      })
    );

  const response =
    await duffelRequest<DuffelOfferRequestResponse>(
      "/air/offer_requests?return_offers=true&supplier_timeout=15000&view=offers",

      accessToken,

      {
        method: "POST",

        timeoutMilliseconds:
          23000,

        body: {
          data: {
            slices: [
              {
                origin:
                  originAirportCode,

                destination:
                  destination.code,

                departure_date:
                  request.outboundDate
              },

              {
                origin:
                  destination.code,

                destination:
                  returnAirportCode,

                departure_date:
                  request.returnDate
              }
            ],

            passengers,

            cabin_class:
              "economy",

            max_connections: 1
          }
        }
      }
    );

  const providerOffers =
    Array.isArray(
      response.data?.offers
    )
      ? response.data!.offers!
      : [];

  const flights =
    providerOffers
      .map((offer) =>
        normalizeOffer(
          offer,
          request
        )
      )
      .filter(
        (
          flight
        ): flight is FlightOption =>
          flight !== null
      );

  return {
    originAirportCode,

    returnAirportCode,

    destinationName:
      destination.name,

    destinationCode:
      destination.code,

    outboundDate:
      request.outboundDate,

    returnDate:
      request.returnDate,

    adultPassengers:
      request.adultPassengers,

    flightBudgetCents:
      request.flightBudgetCents,

    currency:
      request.currency
        .toUpperCase(),

    flights:
      rankFlights(
        flights
      ).slice(
        0,
        request.maximumResults
      )
  };
}