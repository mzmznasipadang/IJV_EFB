export function field(record, key) {
  const value = record?.[key]
  return value && typeof value === "object" ? value.value : value
}

export function flightAirports(flight) {
  if (!flight) return []
  const from = field(flight.origin, "icao_code")
  const to = field(flight.destination, "icao_code")
  const alternates = flight.alternates?.alternate ?? flight.alternates ?? flight.alternate
  const entries = [
    { code: from, role: "Departure" },
    { code: to, role: "Destination" },
    ...[alternates].flat().map(airport => ({ code: field(airport, "icao_code"), role: "Alternate" })),
  ]
  return entries.filter(({ code }, index) =>
    /^[A-Z0-9]{4}$/.test(code ?? "") && entries.findIndex(entry => entry.code === code) === index
  )
}

export function flightNumber(flight) {
  return [field(flight?.general, "icao_airline"), field(flight?.general, "flight_number")].filter(Boolean).join("")
}

export function flightAircraft(flight) {
  return field(flight?.aircraft, "icao_code") || field(flight?.aircraft, "icaocode") || field(flight?.aircraft, "name")
}

export function dispatchPdfUrl(flight) {
  const link = field(flight?.files?.pdf, "link")
  if (!link) return null
  try {
    const directory = new URL(field(flight.files, "directory") || "/", "https://www.simbrief.com/")
    const url = new URL(link, directory)
    if (url.protocol === "https:" && !url.username && !url.password && /(^|\.)(simbrief|navigraph)\.com$/.test(url.hostname)) {
      return url.href
    }
  } catch {
    return null
  }
  return null
}

export async function importDispatch(username, signal) {
  // SimBrief accepts either the numeric pilot ID (userid) or the account username
  const query = new URLSearchParams({ [/^\d+$/.test(username) ? "userid" : "username"]: username, json: "v2" })
  const response = await fetch(`https://www.simbrief.com/api/xml.fetcher.php?${query}`, { signal })
  if (!response.ok) throw new Error("SimBrief could not load a dispatch. Check the username and generate a flight plan in SimBrief.")
  const data = await response.json()
  if (!field(data.origin, "icao_code") || !field(data.destination, "icao_code")) {
    throw new Error("This dispatch has no route. Generate a flight plan in SimBrief and retry.")
  }
  return normalizeDispatchTimes(data)
}

// SimBrief v2 can return ISO timestamps and HH:MM:SS durations. The EFB uses seconds for both.
function normalizeDispatchTimes(flight) {
  const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/
  const duration = /^(\d+):([0-5]\d):([0-5]\d)$/
  const generated = field(flight.params, "time_generated")
  if (timestamp.test(generated)) {
    const parsed = Date.parse(generated)
    if (Number.isFinite(parsed)) flight.params.time_generated = parsed / 1000
  }
  for (const key of Object.keys(flight.times ?? {})) {
    const value = field(flight.times, key)
    if (typeof value !== "string") continue
    if (timestamp.test(value)) {
      const parsed = Date.parse(value)
      if (Number.isFinite(parsed)) flight.times[key] = parsed / 1000
    } else {
      const match = duration.exec(value)
      if (match) flight.times[key] = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    }
  }
  return flight
}

function plannedTime(times, key) {
  const seconds = Number(field(times, key))
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 8.64e12 ? seconds : null
}

export function dispatchTiming(flight) {
  const times = flight?.times
  return {
    etd: plannedTime(times, "est_out") ?? plannedTime(times, "sched_out"),
    eta: plannedTime(times, "est_in") ?? plannedTime(times, "sched_in"),
    ete: plannedTime(times, "est_time_enroute"),
  }
}

export function enrouteDuration(seconds) {
  if (seconds == null) return null
  const minutes = Math.floor(seconds / 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

// Ported from IJV dispatch get_filtered_notams: rank operationally urgent NOTAMs first, keep all of them
const urgentNotamWords = ["CLSD", "CLOSED", "U/S", "UNSERVICEABLE", "DANGER", "RESTRICTED", "RWY", "RUNWAY", "ILS", "GNSS", "GPS"]

export function rankNotams(raw) {
  const seen = new Set()
  return [raw ?? []].flat().filter(notam => {
    const id = notam?.notam_id
    if (!notam || (id && seen.has(id))) return false
    seen.add(id)
    return true
  }).map(notam => {
    const text = String(notam.notam_text || notam.notam_raw || "")
    const upper = text.toUpperCase()
    return { ...notam, text, score: urgentNotamWords.filter(word => upper.includes(word)).length }
  }).sort((a, b) => b.score - a.score)
}

export function flightNotams(flight) {
  if (!flight) return []
  return [
    { airport: flight.origin, role: "Departure" },
    { airport: flight.destination, role: "Destination" },
    ...[flight.alternate ?? []].flat().map(airport => ({ airport, role: "Alternate" })),
  ].filter(({ airport }) => field(airport, "icao_code"))
    .map(({ airport, role }) => ({ code: field(airport, "icao_code"), role, notams: rankNotams(airport.notam) }))
}

function navlogNumber(fix, key) {
  const value = field(fix, key)
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function navlogPosition(fix) {
  const lat = navlogNumber(fix, "pos_lat")
  const lon = navlogNumber(fix, "pos_long")
  return lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null
}

export function navlogLegs(log, departure) {
  const fixes = [log?.fix ?? log ?? []].flat().filter(fix => field(fix, "ident"))
  let totalDistance = 0
  return fixes.map((fix, index) => {
    const ident = field(fix, "ident")
    const distance = navlogNumber(fix, "distance")
    // SimBrief can omit the inbound leg distance at the departure airport.
    const legDistance = distance ?? (index === 0 && ident === departure ? 0 : null)
    totalDistance = totalDistance == null || legDistance == null ? null : totalDistance + legDistance
    return {
      ident,
      airway: field(fix, "via_airway"),
      altitude: navlogNumber(fix, "altitude_feet"),
      track: navlogNumber(fix, "track_mag"),
      distance,
      totalDistance,
      elapsed: navlogNumber(fix, "time_total"),
      fuel: navlogNumber(fix, "fuel_plan_onboard"),
      position: navlogPosition(fix),
      fix,
    }
  })
}

export function alternateNavlogLegs(logs, departure) {
  // V2 supplies an array of routes. Also accept one route supplied directly.
  const routes = Array.isArray(logs) && !logs.some(fix => field(fix, "ident")) ? logs : [logs]
  return routes.map(log => navlogLegs(log, departure)).filter(legs => legs.length)
}

export function longitudeNear(longitude, reference) {
  return reference == null ? longitude : longitude + 360 * Math.round((reference - longitude) / 360)
}

export function navlogMapRoutes(primary, alternates) {
  let destinationLongitude = null
  return [primary, ...alternates].flatMap((legs, index) => {
    let longitude = destinationLongitude
    let segment
    const segments = []
    const waypoints = []
    for (const [fixIndex, leg] of legs.entries()) {
      if (!leg.position) {
        segment = null
        continue
      }
      const [lat, rawLongitude] = leg.position
      // Keep adjacent fixes in the nearest world copy when a leg crosses the date line.
      longitude = longitudeNear(rawLongitude, longitude)
      const position = [lat, longitude]
      if (!segment) {
        segment = []
        segments.push(segment)
      }
      segment.push(position)
      waypoints.push({ ident: leg.ident, position, endpoint: fixIndex === 0 || fixIndex === legs.length - 1 })
    }
    destinationLongitude ??= longitude
    return waypoints.length ? [{ alternate: index > 0, segments, waypoints }] : []
  })
}

// Ported from IJV dispatch formatWindMatrixRow: same 7 levels and stage rules as the PDF wind page
export const windLevels = [10000, 18000, 24000, 30000, 34000, 39000, 45000]

export function windMatrix(flight) {
  const fixes = [flight?.navlog?.fix ?? []].flat()
  const stages = [["CLB", "Climb", "TOC"], ["CRZ", "Cruise", "TOD"], ["DSC", "Descent"]]
  return stages.map(([stage, label, skip]) => ({
    label,
    rows: fixes.filter(fix => fix?.stage === stage && fix.ident !== skip).map(fix => {
      const levels = new Map([fix.wind_data?.level ?? []].flat().map(level => [Number(level.altitude), level]))
      const altitude = Number(fix.altitude_feet) || 0
      const nearest = windLevels.reduce((best, level, index) =>
        Math.abs(level - altitude) < Math.abs(windLevels[best] - altitude) ? index : best, 0)
      return {
        ident: fix.ident, altitude, nearest,
        cells: windLevels.map(level => {
          const data = levels.get(level)
          return data ? { dir: Number(data.wind_dir) || 0, spd: Number(data.wind_spd) || 0, oat: Number(data.oat) || 0 } : null
        }),
      }
    }),
  })).filter(group => group.rows.length)
}

// Keep the active dispatch across reloads until 48 h after SimBrief generated it
const dispatchMaxAge = 48 * 3600 * 1000

export function saveDispatch(storage, key, flight, manifest) {
  try {
    storage.setItem(key, JSON.stringify({ savedAt: Date.now(), flight, manifest }))
  } catch { /* storage full or blocked: the flight still works for this session */ }
}

export function loadDispatch(storage, key, now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(key))
    if (saved?.flight) normalizeDispatchTimes(saved.flight)
    const generated = Number(field(saved?.flight?.params, "time_generated")) * 1000 || saved?.savedAt
    if (saved?.flight && generated && now - generated < dispatchMaxAge) return saved
    storage.removeItem(key)
  } catch { /* corrupt entry: fall through to a fresh import */ }
  return null
}

function insidePolygon(lat, lon, coords) {
  let inside = false
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const a = coords[i], b = coords[j]
    if ((a.lat > lat) !== (b.lat > lat) && lon < (b.lon - a.lon) * (lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

// SIGMETs that are still valid and contain a navlog fix at a level inside the SIGMET's base/top
// shortcut: checks fixes only, so a small area between two far-apart oceanic fixes is missed; densify legs if that matters
export function routeSigmets(flight, sigmets, nowSec = Date.now() / 1000) {
  const fixes = [flight?.navlog?.fix ?? []].flat()
    .map(fix => ({ lat: Number(fix?.pos_lat), lon: Number(fix?.pos_long), alt: Number(fix?.altitude_feet) || 0 }))
    .filter(fix => Number.isFinite(fix.lat) && Number.isFinite(fix.lon))
  return [sigmets ?? []].flat().filter(sigmet => {
    const coords = sigmet?.coords
    if (!Array.isArray(coords) || coords.length < 3 || !(Number(sigmet.validTimeTo) > nowSec)) return false
    const base = Number(sigmet.base) || 0
    const top = Number(sigmet.top) || Infinity
    return fixes.some(fix => fix.alt >= base && fix.alt <= top && insidePolygon(fix.lat, fix.lon, coords))
  })
}

export const sigmetId = sigmet => [sigmet.firId, sigmet.seriesId, sigmet.validTimeFrom].join("-")

const flightLevel = feet => feet ? `FL${String(Math.round(feet / 100)).padStart(3, "0")}` : "SFC"
const hhmm = sec => new Date(sec * 1000).toISOString().slice(11, 16).replace(":", "")

export function sigmetTelex(sigmet) {
  return [`IJV OPS SIGWX ALERT ON ROUTE: ${sigmet.firId} SIGMET ${sigmet.seriesId} ${sigmet.hazard}`,
    sigmet.qualifier, `${flightLevel(Number(sigmet.base))}/${sigmet.top ? flightLevel(Number(sigmet.top)) : "UNK"}`,
    `VALID ${hhmm(sigmet.validTimeFrom)}-${hhmm(sigmet.validTimeTo)}Z`,
    sigmet.dir && `MOV ${sigmet.dir} ${sigmet.spd ?? ""}KT`].filter(Boolean).join(" ").toUpperCase()
}

const zulu = sec => Number(sec) ? hhmm(Number(sec)) + "Z" : "----"

export function ofpTelex(flight) {
  const units = field(flight.params, "units") || ""
  const weight = key => field(flight.weights, key) ? `${field(flight.weights, key)}` : "-"
  return [`IJV OPS OFP ${flightNumber(flight)} ${field(flight.origin, "icao_code")}-${field(flight.destination, "icao_code")}`,
    `ETD ${zulu(field(flight.times, "est_out") || field(flight.times, "sched_out"))} ETA ${zulu(field(flight.times, "est_in") || field(flight.times, "sched_in"))}`,
    `CRZ ${flightLevel(Number(field(flight.general, "initial_altitude")))}`,
    `BLOCK FUEL ${field(flight.fuel, "plan_ramp") ?? "-"} ZFW ${weight("est_zfw")} TOW ${weight("est_tow")} LDW ${weight("est_ldw")} ${units}`,
    `PAX ${field(flight.weights, "pax_count") ?? "-"}`,
    `ALTN ${flightAirports(flight).filter(a => a.role === "Alternate").map(a => a.code).join("/") || "NIL"}`,
    `RTE ${field(flight.general, "route") || "-"}`].join(" ").toUpperCase()
}

// Urgent NOTAMs only (rankNotams score > 0), up to 3 per airport
export function notamTelex(flight) {
  const parts = flightNotams(flight).map(({ code, notams }) => {
    const urgent = notams.filter(n => n.score > 0).slice(0, 3).map(n => n.text.replace(/\s+/g, " ").slice(0, 160))
    return `${code}: ${urgent.length ? urgent.join(" // ") : "NIL URGENT"}`
  })
  return `IJV OPS NOTAM DIGEST ${parts.join(" ")}`.toUpperCase().slice(0, 1500)
}

export const newDispatchTelex = flight =>
  `IJV OPS NEW DISPATCH ISSUED ${flightNumber(flight)} ${field(flight.origin, "icao_code")}-${field(flight.destination, "icao_code")} ` +
  `ETD ${zulu(field(flight.times, "est_out") || field(flight.times, "sched_out"))}. RELOAD OFP IN FMC/EFB.`.toUpperCase()

// OOOI times from aircraft downlinks, e.g. progress "WIII/WSSS OUT/0512"; the latest report of each wins
export function oooiTimes(log) {
  const times = {}
  for (const entry of [log ?? []].flat()) {
    if (entry?.dir !== "down") continue
    for (const [, event, time] of String(entry.text).toUpperCase().matchAll(/\b(OUT|OFF|ON|IN)\b[\s/:]*(\d{4})\b/g)) times[event] = time
  }
  return times
}

// Crew Navlog entries (ETO, ATO, actual fuel, note), keyed `${route}:${legIndex}` where route is "p" or "a0", "a1"…
export function dispatchId(flight) {
  return String(field(flight?.params, "request_id") || field(flight?.params, "time_generated") || "")
}

export function dispatchFuelUnit(flight) {
  const raw = String(field(flight?.params, "units") ?? "").toLowerCase()
  return /^kgs?$/.test(raw) ? "kg" : /^lbs?$/.test(raw) ? "lb" : null
}

// One record per pilot: importing another dispatch replaces the previous dispatch's entries
export function loadNavlogEntries(storage, key, id) {
  try {
    const saved = JSON.parse(storage.getItem(key))
    if (id && saved?.dispatchId === id && saved.entries && typeof saved.entries === "object") return saved.entries
  } catch { /* corrupt entry: start empty */ }
  return {}
}

export function saveNavlogEntries(storage, key, id, entries) {
  try {
    storage.setItem(key, JSON.stringify({ dispatchId: id, entries }))
  } catch { /* storage full or blocked: entries last for this session */ }
}

export const validUtcTime = value => value === "" || /^([01]\d|2[0-3])[0-5]\d$/.test(value)

// Returns the fuel as a number, "" to clear, or null when invalid
export function parseFuel(value, flight) {
  const text = String(value).trim()
  if (text === "") return ""
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const fuel = Number(text)
  const ramp = Number(field(flight?.fuel, "plan_ramp"))
  return ramp > 0 && fuel > ramp * 1.5 ? null : fuel
}

// shortcut: assumes SimBrief fix time_total counts from takeoff (est_off); confirm against an OFP if ETOs look off by the taxi time
export function takeoffTime(flight) {
  const off = Number(field(flight?.times, "est_off"))
  if (off > 0) return off
  const out = Number(field(flight?.times, "est_out"))
  return out > 0 ? out + (Number(field(flight?.times, "taxi_out")) || 0) : null
}

export const plannedEto = (takeoff, elapsed) => takeoff != null && elapsed != null ? hhmm(takeoff + elapsed) : ""

// Actual takeoff fuel: crew-entered ramp fuel on the release minus planned taxi fuel
export function actualTakeoffFuel(flight, entries) {
  const ramp = entries?.release?.ramp
  if (typeof ramp !== "number") return null
  return ramp - (Number(field(flight?.fuel, "taxi")) || 0)
}

// Planned vs actual fuel on the primary route; the latest check is the furthest waypoint with actual fuel,
// or the actual takeoff fuel when no waypoint has been checked yet
export function fuelStatus(legs, entries, takeoff = null) {
  const rows = legs.map((leg, index) => {
    const actual = entries[`p:${index}`]?.fuel
    const hasActual = typeof actual === "number"
    return { index, leg, entry: entries[`p:${index}`] ?? {}, planned: leg.fuel, actual: hasActual ? actual : null,
      deviation: hasActual && leg.fuel != null ? actual - leg.fuel : null }
  })
  const takeoffRow = takeoff?.actual != null && takeoff.planned != null ? { index: -1, leg: { ident: "Takeoff" }, entry: {},
    planned: takeoff.planned, actual: takeoff.actual, deviation: takeoff.actual - takeoff.planned } : null
  const latest = rows.findLast(row => row.deviation != null) ?? takeoffRow
  const destinationPlanned = legs.at(-1)?.fuel ?? null
  return { rows, takeoff: takeoffRow, latest, destinationPlanned,
    destinationEstimate: latest && destinationPlanned != null ? destinationPlanned + latest.deviation : null }
}

// HHMM as epoch seconds on the UTC day that puts it closest to `near` (handles flights across midnight)
export function utcTimeNear(text, near) {
  if (!/^\d{4}$/.test(text ?? "") || near == null) return null
  const day = Math.floor(near / 86400) * 86400
  const time = day + Number(text.slice(0, 2)) * 3600 + Number(text.slice(2)) * 60
  return [time - 86400, time, time + 86400].reduce((best, value) => Math.abs(value - near) < Math.abs(best - near) ? value : best)
}

// Estimated time over each leg (epoch s): latest ATO before it, else actual airborne time, else planned takeoff,
// plus the planned elapsed time between the two
export function revisedEtos(legs, entries, takeoff, route = "p") {
  const airborne = utcTimeNear(entries?.dep?.off, takeoff) ?? takeoff
  let base = airborne == null ? null : { time: airborne, elapsed: 0 }
  return legs.map((leg, index) => {
    const eto = base && leg.elapsed != null ? base.time + leg.elapsed - base.elapsed : null
    const ato = utcTimeNear(entries?.[`${route}:${index}`]?.ato, eto ?? takeoff)
    if (ato != null && leg.elapsed != null) base = { time: ato, elapsed: leg.elapsed }
    return eto
  })
}

// Index of the latest primary waypoint whose estimated time has passed with no fuel check since the last one, or -1
export function fuelCheckDue(legs, entries, etos, nowSec = Date.now() / 1000) {
  let due = -1
  legs.forEach((leg, index) => {
    if (typeof entries[`p:${index}`]?.fuel === "number") due = -1
    else if (etos[index] != null && etos[index] <= nowSec) due = index
  })
  return due
}

// Flight progress for the home status: distance flown from the latest ATO, else time since airborne
export function flightProgress(flight, legs, entries, nowSec = Date.now() / 1000) {
  const takeoff = takeoffTime(flight)
  const etos = revisedEtos(legs, entries, takeoff)
  const totalNm = legs.findLast(leg => leg.totalDistance != null)?.totalDistance ?? null
  const etd = utcTimeNear(entries?.dep?.out, takeoff) ?? (Number(field(flight?.times, "est_out")) || null)
  const eta = etos.findLast(time => time != null) ?? (Number(field(flight?.times, "est_on")) || null)
  const airborne = utcTimeNear(entries?.dep?.off, takeoff)
  const lastAto = legs.findLastIndex((leg, index) => entries?.[`p:${index}`]?.ato)
  let fraction = 0
  if (lastAto >= 0 && totalNm) fraction = (legs[lastAto].totalDistance ?? 0) / totalNm
  else if (airborne != null && eta > airborne) fraction = (nowSec - airborne) / (eta - airborne)
  fraction = Math.min(1, Math.max(0, fraction))
  const arrived = lastAto === legs.length - 1 && legs.length > 0
  const phase = arrived ? "Arrived" : lastAto >= 0 || airborne != null ? "En route" : entries?.dep?.out ? "Taxi out" : "Scheduled"
  return { phase, fraction: arrived ? 1 : fraction, totalNm, flownNm: totalNm == null ? null : Math.round(totalNm * fraction), etd, eta,
    basis: lastAto >= 0 ? `ATO at ${legs[lastAto].ident}` : airborne != null ? "time since airborne" : null }
}

// Crew release entries: weights and fuel in the dispatch unit, speeds in knots. Returns the number, "" to clear, or null when invalid
export function parseReleaseNumber(value, { min = 0, max = Infinity } = {}) {
  const text = String(value).trim()
  if (text === "") return ""
  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const number = Number(text)
  return number >= min && number <= max ? number : null
}
