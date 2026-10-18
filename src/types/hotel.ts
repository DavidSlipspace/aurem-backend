export type HotelProviderRequest = {
  destination: string;
  checkInDate: string;
  checkOutDate: string;
  adultGuests: number;
  rooms: number;
  radiusKilometers: number;
  minimumStarRating?: number;
  hotelBudgetCents: number;
  currency: string;
  maximumResults: number;
};

export type HotelOption = {
  searchResultId: string;
  accommodationId: string;

  name: string;
  description: string | null;

  address: string;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;

  latitude: number | null;
  longitude: number | null;
  distanceFromDestinationMiles: number | null;

  starRating: number | null;
  reviewScore: number | null;
  reviewCount: number | null;

  cheapestTotalAmountCents: number;
  currency: string;

  photoUrl: string | null;
  amenities: string[];

  loyaltyProgram: string | null;
  expiresAt: string | null;

  isWithinBudget: boolean;
};

export type HotelProviderResult = {
  destination: string;
  resolvedDestination: string;

  destinationLatitude: number;
  destinationLongitude: number;

  checkInDate: string;
  checkOutDate: string;

  adultGuests: number;
  rooms: number;

  radiusKilometers: number;
  minimumStarRating: number | null;
  hotelBudgetCents: number;
  currency: string;

  hotels: HotelOption[];
};

export type SearchTripHotelsResult = {
  tripReferenceId: string;
  travelerName: string;

  destination: string;
  checkInDate: string;
  checkOutDate: string;

  adultGuests: number;
  rooms: number;

  radiusKilometers: number;
  minimumStarRating: number | null;

  totalTripBudgetCents: number;
  hotelBudgetCents: number;
  currency: string;

  hotels: HotelOption[];
};