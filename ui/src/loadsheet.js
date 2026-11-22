import { dispatchFuelUnit, dispatchTiming, enrouteDuration, field, flightAircraft, flightNumber } from "./dispatch.js"

const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
const identifier = value => String(value ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "")
const mass = value => value != null && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? String(Number(value)) : null
const code = airport => identifier(field(airport, "iata_code")) || identifier(field(airport, "icao_code"))

function utcParts(value) {
  const date = new Date(Number(value) * 1000)
  if (!(Number(value) > 0) || !Number.isFinite(date.valueOf())) return null
  const iso = date.toISOString()
  const day = iso.slice(8, 10)
  return { day, date: `${day}${months[date.getUTCMonth()]}${iso.slice(2, 4)}`, time: `${iso.slice(11, 16).replace(":", "")}Z` }
}

export function hasLoadsheetActuals(release) {
  return Boolean(release && [release.zfw, release.tow, release.ramp].every(value => typeof value === "number" && Number.isFinite(value)) &&
    release.zfw > 0 && release.tow > 0 && release.ramp >= 0)
}

function loadsheetData(flight, release) {
  const actual = hasLoadsheetActuals(release)
  const { etd, eta, ete } = dispatchTiming(flight)
  const weight = key => mass(field(flight.weights, key))
  return {
    actual,
    departure: utcParts(etd),
    arrival: utcParts(eta),
    enroute: enrouteDuration(ete),
    units: { kg: "KGS", lb: "LBS" }[dispatchFuelUnit(flight)],
    origin: code(flight.origin),
    destination: code(flight.destination),
    zfw: actual ? mass(release.zfw) : weight("est_zfw"),
    tow: actual ? mass(release.tow) : weight("est_tow"),
    ldw: weight("est_ldw"),
    ramp: mass(actual ? release.ramp : field(flight.fuel, "plan_ramp")),
    pax: weight("pax_count"),
    cargo: weight("cargo"),
    payload: weight("payload"),
  }
}

export function loadsheetText(flight, release) {
  return formattedLoadsheet(flight, loadsheetData(flight, release))
}

function formattedLoadsheet(flight, data, boeing = false) {
  const issued = utcParts(field(flight.params, "time_generated"))
  const number = identifier(flightNumber(flight) || field(flight.atc, "callsign")) || "N/A"
  const revision = identifier(field(flight.general, "release"))
  const row = (label, value) => `${label.padEnd(13)}${value ?? "N/A"}`
  const status = data.actual ? "CREW ACTUAL WEIGHTS" : "PLANNED WEIGHTS"
  return [
    `LOADSHEET ${issued?.date ?? "-------"}`,
    `${issued?.time ?? "-----"}${revision ? `  E${revision}` : ""}  ${data.units ?? "UNITS N/A"}`,
    `${number}/${data.departure?.day ?? "--"} ${data.origin || "N/A"} ${data.destination || "N/A"}`,
    ...(!boeing ? [status] : []),
    row("TOB", "N/A"),
    row("ZFW", data.zfw),
    row("MACZFW", "N/A"),
    row("MACTOW", "N/A"),
    "------------------------",
    ...(boeing ? [status] : []),
    row("PAX (PLN)", data.pax),
    row("TOW", data.tow),
    row("EST LDW", data.ldw),
    row("RAMP FUEL", data.ramp),
    row("CARGO (PLN)", data.cargo),
    row("PAYLOAD(PLN)", data.payload),
    "------------------------",
    `ETD ${data.departure?.time ?? "-----"}  ETA ${data.arrival?.time ?? "-----"}`,
    `ETE ${data.enroute ?? "--:--"}`,
  ].join("\n")
}

// Cockpit telex clients reflow whitespace. Keep each label and value in one word.
export function loadsheetTelex(flight, release) {
  const data = loadsheetData(flight, release)
  // The reference 737 page puts TOB/ZFW/MAC before the divider and detailed weights.
  if (/^(?:B73[1-9]|B3[789X]M)$/i.test(flightAircraft(flight) ?? "")) return formattedLoadsheet(flight, data, true)
  const callsign = identifier(field(flight.atc, "callsign") || flightNumber(flight)) || "FLIGHT-NA"
  const plan = data.actual ? "PLN-" : ""
  const fields = [
    ["ZFW", data.zfw], ["TOW", data.tow], [data.actual ? "ELDW" : "LDW", data.ldw], ["RAMP", data.ramp],
    [`${plan}PAX`, data.pax], [`${plan}CARGO`, data.cargo], [`${plan}PAYLOAD`, data.payload],
    ["ETD", data.departure?.time], ["ETA", data.arrival?.time], ["ETE", data.enroute],
  ]
  return [
    data.actual ? "IJV CREW LOADSHEET" : "IJV PLANNED LOADSHEET",
    callsign, `${data.origin || "NA"}-${data.destination || "NA"}`, data.units ?? "UNITS-NA",
    ...fields.filter(([, value]) => value != null).map(([label, value]) => `${label}:${value}`),
  ].join(" ")
}
