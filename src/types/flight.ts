export type FlightProviderRequest = {
  originAirportCode: string;

  returnAirportCode: string;

  destinationQuery: string;

  outboundDate: string;

  returnDate: string;

  adultPassengers: number;

  flightBudgetCents: number;

  currency: string;

  maximumResults: number;
};

export type FlightSegment = {
  id: string;

  originAirportCode: string;
  originAirportName: string;

  destinationAirportCode: string;
  destinationAirportName: string;

  departingAt: string;
  arrivingAt: string;

  durationMinutes: number | null;

  marketingCarrierName: string;
  marketingCarrierCode: string | null;

  operatingCarrierName: string;
  operatingCarrierCode: string | null;

  flightNumber: string;

  aircraftName: string | null;
};

export type FlightJourney = {
  originAirportCode: string;
  destinationAirportCode: string;

  departingAt: string;
  arrivingAt: string;

  durationMinutes: number | null;

  stopCount: number;

  segments: FlightSegment[];
};

export type FlightOption = {
  offerId: string;

  ownerName: string;
  ownerCode: string | null;
  ownerLogoUrl: string | null;

  totalAmountCents: number;
  currency: string;

  expiresAt: string | null;

  outbound: FlightJourney;
  return: FlightJourney;

  isWithinBudget: boolean;
};

export type FlightProviderResult = {
  originAirportCode: string;

  returnAirportCode: string;

  destinationName: string;
  destinationCode: string;

  outboundDate: string;
  returnDate: string;

  adultPassengers: number;

  flightBudgetCents: number;

  currency: string;

  flights: FlightOption[];
};

export type SearchTripFlightsResult = {
  tripReferenceId: string;
  travelerName: string;

  originAirportCode: string;

  returnAirportCode: string;

  destinationName: string;
  destinationCode: string;

  outboundDate: string;
  returnDate: string;

  adultPassengers: number;

  totalTripBudgetCents: number;
  flightBudgetCents: number;

  currency: string;

  flights: FlightOption[];
};