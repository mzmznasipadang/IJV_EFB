import { dispatchFuelUnit, dispatchTiming, enrouteDuration, field, flightNumber } from "./dispatch.js"

const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
const identifier = value => String(value ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "")
const mass = value => value != null && String(value).trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? String(Number(value)) : "N/A"
const code = airport => identifier(field(airport, "iata_code")) || identifier(field(airport, "icao_code")) || "N/A"

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

export function loadsheetText(flight, release) {
  const actual = hasLoadsheetActuals(release)
  const { etd, eta, ete } = dispatchTiming(flight)
  const departure = utcParts(etd)
  const issued = utcParts(field(flight.params, "time_generated"))
  const number = identifier(flightNumber(flight) || field(flight.atc, "callsign")) || "N/A"
  const revision = identifier(field(flight.general, "release"))
  const units = { kg: "KGS", lb: "LBS" }[dispatchFuelUnit(flight)] || "UNITS N/A"
  const weight = key => mass(field(flight.weights, key))
  const row = (label, value) => `${label.padEnd(13)}${value}`
  return [
    `LOADSHEET ${issued?.date ?? "-------"}`,
    `${issued?.time ?? "-----"}${revision ? `  E${revision}` : ""}  ${units}`,
    `${number}/${departure?.day ?? "--"} ${code(flight.origin)} ${code(flight.destination)}`,
    actual ? "CREW ACTUAL WEIGHTS" : "PLANNED WEIGHTS",
    row("TOB", "N/A"),
    row("ZFW", actual ? mass(release.zfw) : weight("est_zfw")),
    row("MACZFW", "N/A"),
    row("MACTOW", "N/A"),
    "------------------------",
    row("PAX (PLN)", weight("pax_count")),
    row("TOW", actual ? mass(release.tow) : weight("est_tow")),
    row("EST LDW", weight("est_ldw")),
    row("RAMP FUEL", mass(actual ? release.ramp : field(flight.fuel, "plan_ramp"))),
    row("CARGO (PLN)", weight("cargo")),
    row("PAYLOAD(PLN)", weight("payload")),
    "------------------------",
    `ETD ${departure?.time ?? "-----"}  ETA ${utcParts(eta)?.time ?? "-----"}`,
    `ETE ${enrouteDuration(ete) ?? "--:--"}`,
  ].join("\n")
}
