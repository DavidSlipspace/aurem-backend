export type ParsedTripBody = {
  ipcmUserId: string; travelerProfileIds: string[]; travelerProfileId: string; tripPurpose: string;
  outboundDate: string; returnDate: string; outboundAirport: string; returnAirport: string;
  returnDepartureAirport: string | null; returnArrivalAirport: string | null;
  destinationCity: string | null; clinicZipCode: string | null;
  hotelProximityPreference: string | null; minimumHotelStarRating: number | null;
  budgetFilter: number | null;
  companionTraveler: boolean; ipcmApprovalRequired: boolean;
};
function string(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function optionalString(value: unknown): string | null { return string(value) || null; }
function airport(value: unknown, required: boolean, label: string): string | null {
  const code = string(value).toUpperCase();
  if (!code && !required) return null;
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(`Select a valid ${label}.`);
  return code;
}
export function parseTripBody(raw: string | null): ParsedTripBody {
  let value: unknown;
  try { value = JSON.parse(raw || "null"); } catch { throw new Error("Invalid JSON body."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid trip request.");
  const input = value as Record<string, unknown>;
  const ipcmUserId = string(input.ipcmUserId), travelerProfileId = string(input.travelerProfileId);
  const travelerProfileIds = Array.isArray(input.travelerProfileIds) ? [...new Set(input.travelerProfileIds.map(string))] : [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(travelerProfileId) || !travelerProfileIds.includes(travelerProfileId) || travelerProfileIds.some(id => !uuid.test(id))) throw new Error("Select valid travelers and a primary traveler.");
  const tripPurpose = string(input.tripPurpose);
  const outboundDate = string(input.outboundDate), returnDate = string(input.returnDate);
  if (!tripPurpose) throw new Error("Trip purpose is required.");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(outboundDate) || !datePattern.test(returnDate) ||
      !Number.isFinite(Date.parse(outboundDate)) || !Number.isFinite(Date.parse(returnDate))) throw new Error("Valid travel dates are required.");
  if (returnDate < outboundDate) throw new Error("Return date cannot precede departure date.");
  const clinicZipCode = optionalString(input.clinicZipCode);
  if (clinicZipCode && !/^\d{5}(?:-\d{4})?$/.test(clinicZipCode)) throw new Error("Clinic ZIP must be a US ZIP code.");
  const destinationCity = optionalString(input.destinationCity);
  if (!destinationCity) throw new Error("Destination city is required.");
  const minimumHotelStarRating = input.minimumHotelStarRating == null || input.minimumHotelStarRating === ""
    ? null : Number(input.minimumHotelStarRating);
  if (minimumHotelStarRating !== null && (!Number.isInteger(minimumHotelStarRating) || minimumHotelStarRating < 1 || minimumHotelStarRating > 5)) throw new Error("Hotel rating must be 1–5.");
  const budgetFilter = input.budgetFilter == null ? null : Number(input.budgetFilter);
  if (budgetFilter !== null && (!Number.isSafeInteger(budgetFilter) || budgetFilter < 0 || budgetFilter > 2147483647)) throw new Error("Trip budget must be non-negative whole cents.");
  return {
    ipcmUserId, travelerProfileIds, travelerProfileId, tripPurpose, outboundDate, returnDate,
    outboundAirport: airport(input.outboundAirport, true, "origin airport")!,
    returnAirport: airport(input.returnAirport, true, "destination airport")!,
    returnDepartureAirport: airport(input.returnDepartureAirport, false, "return departure airport"),
    returnArrivalAirport: airport(input.returnArrivalAirport, false, "return arrival airport"),
    destinationCity, clinicZipCode, hotelProximityPreference: optionalString(input.hotelProximityPreference),
    minimumHotelStarRating, budgetFilter,
    companionTraveler: input.companionTraveler === true, ipcmApprovalRequired: input.ipcmApprovalRequired === true
  };
}
