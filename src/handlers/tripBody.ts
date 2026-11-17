export type ParsedTripBody = {
  caseId: string; travelerProfileId: string; tripPurpose: string;
  outboundDate: string; returnDate: string; outboundAirport: string; returnAirport: string;
  returnDepartureAirport: string | null; returnArrivalAirport: string | null;
  destinationCity: string | null; clinicZipCode: string | null;
  hotelProximityPreference: string | null; minimumHotelStarRating: number | null;
  budgetFilter: number | null; budgetIsManual: boolean;
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
  const caseId = string(input.caseId), travelerProfileId = string(input.travelerProfileId);
  const tripPurpose = string(input.tripPurpose);
  const outboundDate = string(input.outboundDate), returnDate = string(input.returnDate);
  if (!caseId || !travelerProfileId || !tripPurpose) throw new Error("Case, traveler and trip purpose are required.");
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
  const budgetIsManual = input.budgetIsManual === true;
  const budgetFilter = budgetIsManual ? Number(input.budgetFilter) : null;
  if (budgetIsManual && (input.budgetFilter == null || !Number.isSafeInteger(budgetFilter) || budgetFilter! < 0)) throw new Error("Manual budget must be non-negative whole cents.");
  return {
    caseId, travelerProfileId, tripPurpose, outboundDate, returnDate,
    outboundAirport: airport(input.outboundAirport, true, "origin airport")!,
    returnAirport: airport(input.returnAirport, true, "destination airport")!,
    returnDepartureAirport: airport(input.returnDepartureAirport, false, "return departure airport"),
    returnArrivalAirport: airport(input.returnArrivalAirport, false, "return arrival airport"),
    destinationCity, clinicZipCode, hotelProximityPreference: optionalString(input.hotelProximityPreference),
    minimumHotelStarRating, budgetFilter, budgetIsManual,
    companionTraveler: input.companionTraveler === true, ipcmApprovalRequired: input.ipcmApprovalRequired === true
  };
}
