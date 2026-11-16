// Plain-text OFP documents, ported from the IJV PDF template (ops/ijv-efb-dispatch/ofp_render.py)
import { field, rankNotams } from "./dispatch.js"

const text = (record, key) => { const value = field(record, key); return value == null || typeof value === "object" ? "" : String(value) }
const int = value => { const number = parseInt(value, 10); return Number.isFinite(number) ? number : 0 }
const list = value => [value ?? []].flat().filter(item => item && typeof item === "object")
const padL = (value, width, char = "0") => String(value ?? "").padStart(width, char)
const padR = (value, width) => String(value ?? "").padEnd(width, " ")
const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

// php_date() in ofp_render.py: UTC formats of an epoch (or of a duration in seconds)
export function phpDate(format, timestamp) {
  if (timestamp == null || timestamp === "" || !Number.isFinite(Number(timestamp))) return ""
  const date = new Date(Math.trunc(Number(timestamp)) * 1000)
  const two = value => String(value).padStart(2, "0")
  const [d, m, y, H, i] = [two(date.getUTCDate()), two(date.getUTCMonth() + 1), two(date.getUTCFullYear() % 100), two(date.getUTCHours()), two(date.getUTCMinutes())]
  return { Hi: H + i, "H:i": `${H}:${i}`, "H.i": `${H}.${i}`, dMy: d + months[date.getUTCMonth()] + y, "d/m/y": `${d}/${m}/${y}`,
    "d-m-y": `${d}-${m}-${y}`, "Y-m-d": date.toISOString().slice(0, 10) }[format] ?? date.toISOString().slice(0, 10)
}

function coordinate(value, isLat) {
  const number = Number(value)
  if (value == null || value === "" || !Number.isFinite(number)) return ""
  const degrees = Math.trunc(Math.abs(number))
  const minutes = ((Math.abs(number) - degrees) * 60).toFixed(1).padStart(4, "0")
  return (isLat ? (number >= 0 ? "N" : "S") : (number >= 0 ? "E" : "W")) + padL(degrees, isLat ? 2 : 3) + minutes
}
export const latLon = (lat, lon) => `${coordinate(lat, true)} ${coordinate(lon, false)}`

export function isa(fix) {
  const value = parseInt(text(fix, "oat_isa_dev"), 10)
  return Number.isFinite(value) ? `ISA${value < 0 ? "-" : "+"}${padL(Math.abs(value), 2)}` : "ISA"
}

export const windComp = value => { const number = int(value); return `${number < 0 ? "M" : "P"}${padL(Math.abs(number), 3)}` }

export function cruiseProfile(profile, costIndex) {
  if (!profile) return ""
  const compact = String(profile).toUpperCase().replace(/ /g, "")
  if (compact.startsWith("M") || compact === "LRC" || !compact.startsWith("CI")) return String(profile)
  const digits = compact.match(/\d+/)?.[0] ?? (Number.isFinite(parseInt(costIndex, 10)) ? costIndex : null)
  return digits == null ? String(profile) : `CI${padL(int(digits), 3)}`
}

function perfFactor(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || value === "" || value == null) return "+00.0"
  return (number - 1 >= 0 ? "+" : "-") + Math.abs((number - 1) * 100).toFixed(1).padStart(4, "0")
}

function prognosisTimes(etd) {
  if (!Number.isFinite(Number(etd)) || etd === "") return "PROG TIMES N/A"
  const date = new Date(Number(etd) * 1000)
  let next = Math.ceil(date.getUTCHours() / 3) * 3
  return Array.from({ length: 5 }, () => {
    const day = new Date(date.getTime() + Math.floor(next / 24) * 86400000)
    const value = padL(day.getUTCDate(), 2) + "00" + padL(next % 24, 2)
    next += 3
    return value
  }).join(" ") + "UKM"
}

const elevation = value => Number.isFinite(parseInt(value, 10)) ? padL(parseInt(value, 10), 4) : "0000"
const bucket = (fuelExtra, label) => list(fuelExtra?.bucket).find(item => text(item, "label").toUpperCase() === label) ?? {}
const bucketFuel = (fuelExtra, label) => int(text(bucket(fuelExtra, label), "fuel"))
const bucketTime = (fuelExtra, label) => int(text(bucket(fuelExtra, label), "time"))
const alternates = flight => list(flight?.alternate)
// unit_label(): LBS only when SimBrief planned in pounds
const unit = flight => text(flight?.params, "units").toUpperCase().startsWith("LB") ? "LBS" : "KGS"

export function fooId(requestId) {
  const hash = parseInt(String(requestId ?? "").slice(0, 8), 16)
  return Number.isFinite(hash) ? 1000 + (hash % 9000) : 1234
}

// get_filtered_notams(): the four most urgent NOTAMs for one airport
const topNotams = raw => rankNotams(raw).slice(0, 4).map(notam => ({ id: notam.notam_id ?? "", text: notam.text }))

export function briefingText(flight) {
  const { general = {}, origin = {}, destination = {}, times = {}, weights = {}, aircraft = {} } = flight
  const airports = [
    [origin, "STD", phpDate("Hi", text(times, "sched_out"))],
    [destination, "ETA", phpDate("Hi", text(times, "est_in"))],
    ...alternates(flight).map(alt => [alt, "ETA (ALTN)", text(alt, "ete") ? phpDate("Hi", int(text(times, "est_in")) + int(text(alt, "ete"))) : "...."]),
  ].filter(([airport]) => text(airport, "icao_code"))
  const lines = [
    "BRIEFING TEXT",
    `${text(general, "icao_airline")}${text(general, "flight_number")} ${text(origin, "icao_code")}-${text(destination, "icao_code")} ${text(aircraft, "reg")} ${phpDate("d/m/y", text(times, "sched_out"))}`,
    "",
    "1. CREW ALERT", "   NIL", "",
    "2. AIRCRAFT STATUS", "   APU       : SERVICEABLE", "   HIL       : NIL", "",
    "3. NOTAM & WEATHER",
  ]
  for (const [airport, label, time] of airports) {
    const notams = topNotams(airport.notam)
    lines.push("", `${text(airport, "icao_code")}/${text(airport, "iata_code")}  ${label} ${time}${time === "...." ? "" : "Z"}`, "NOTAM:")
    if (!notams.length) lines.push("NO SIGNIFICANT NOTAM.")
    notams.forEach((notam, index) => lines.push(notam.id, notam.text, ...(index < notams.length - 1 ? ["."] : [])))
    lines.push("FORECAST WEATHER:", text(airport, "taf") || "REFER TO WX PKG")
  }
  lines.push("",
    "4. SIGNIFICANT WX EN-ROUTE",
    "   TYPHOON      : NIL", "   TURBULENCE   : LIGHT", "   JETSTREAM    : PSE CHECK SIGWX", "   CLOUDS       : PSE CHECK SIGWX",
    `   WIND COMP.   : ${windComp(text(general, "avg_wind_comp"))}`, "",
    "5. EST PAYLOAD",
    `   PAX          : ${text(weights, "pax_count")}`, `   CARGO        : ${text(weights, "cargo")}`,
    `   PAYLOAD      : ${text(weights, "payload")} ${unit(flight)}`)
  return lines.join("\n")
}

const rule = "-".repeat(75)

// release: crew entries for this dispatch ({ fuelReq, signedBy, signedAt })
export function releaseText(flight, release = {}) {
  const { general = {}, origin = {}, destination = {}, times = {}, weights = {}, fuel = {}, aircraft = {}, params = {}, crew = {}, atc = {} } = flight
  const u = unit(flight)
  const alts = alternates(flight)
  const etops = flight.etops && typeof flight.etops === "object" && !Array.isArray(flight.etops) ? flight.etops : null
  const code = airport => `${text(airport, "iata_code")}/${text(airport, "icao_code")}`
  const wx = (left, right) => `    ${padR(left, 36)}${right}`
  const pax = text(weights, "pax_count")
  const signed = release.signedAt ? `${String(release.signedBy ?? "").toUpperCase()} ${phpDate("Hi", Math.floor(release.signedAt / 1000))}Z ${phpDate("dMy", Math.floor(release.signedAt / 1000))}` : "......................"
  return [
    rule, `${" ".repeat(29)}DISPATCH RELEASE`, rule,
    `VALID U/I ${phpDate("Hi", int(text(times, "sched_out")) + 21600)}Z`,
    `REF PLAN ${text(params, "request_id").slice(-5)} / REV NBR ${text(general, "release")}`,
    `${text(atc, "callsign")}   ${phpDate("dMy", text(times, "sched_out"))} ETD ${phpDate("Hi", text(times, "sched_out"))}Z  ETA ${phpDate("Hi", text(times, "est_in"))}Z / FT ${phpDate("Hi", text(times, "est_block"))} IFR ${text(aircraft, "reg")}`,
    "",
    `1.  POD/POA : ${text(origin, "icao_code")}/${text(destination, "icao_code")}`,
    "2.  INITIAL DESTINATION (FOR PLANNED RE-DISPATCH AS APPLICABLE):",
    "3.  WX",
    wx(`ORG ${code(origin)}  CHECKED`, alts[0] ? `AL1 ${code(alts[0])}  CHECKED` : ""),
    wx(`DES ${code(destination)}  CHECKED`, alts[1] ? `AL2 ${code(alts[1])}  CHECKED` : ""),
    "4.  NOTAM AND/OR AERONAUTICAL INFORMATION",
    "    ALL NOTAMS SIGNIFICANT TO FLIGHT ARE CONSIDERED",
    "5.  LOAD",
    `    EST PAX ADL${padL(pax, 3)}/CHD000/INF000          TOTAL  ${pax}`,
    `    EST CGO ${text(weights, "cargo")} ${u}`,
    `    EST PLD ${text(weights, "payload")} ${u}`,
    "6.  FLIGHT PLAN DATA",
    `    TRP   ${padL(text(fuel, "enroute_burn"), 6)}   ${u} ${phpDate("H:i", text(times, "est_time_enroute"))}         EZF    ${padL(text(weights, "est_zfw"), 6)}   MAX ${padL(text(weights, "max_zfw"), 6)}`,
    `    RES   ${padL(text(fuel, "reserve"), 6)}   ${u} ${phpDate("H:i", text(times, "reserve_time"))}         ELW    ${padL(text(weights, "est_ldw"), 6)}   MAX ${padL(text(weights, "max_ldw"), 6)}`,
    ...(alts[0] ? [`    ALT   ${padL(text(fuel, "alternate_burn"), 6)}   ${u} ${phpDate("H:i", text(alts[0], "burn"))}         ETW    ${padL(text(weights, "est_tow"), 6)}   MAX ${padL(text(weights, "max_tow"), 6)}`] : []),
    `    BLK   ${padL(text(fuel, "plan_ramp"), 6)}   ${u} ${phpDate("H:i", text(times, "endurance"))}`,
    `7.  ETOPS FLIGHT: ${etops ? `YES     ETOPS DIVERSION TIME: ${text(etops, "rule")} MIN` : "NO"}`,
    `8.  ENROUTE / ETOPS ALTERNATE: ${list(etops?.suitable_airport).map(airport => text(airport, "icao_code")).join(" ") || "..."}`,
    "9.  TAKE OFF ALTERNATE (IF REQUIRED) : ......",
    `10. DESTINATION ALTERNATE: 1. ${text(alts[0], "icao_code") || "...."}   2. ${text(alts[1], "icao_code") || "...."}`,
    `11. FUEL REQ AFTER BRIEF: ${release.fuelReq != null ? release.fuelReq : "............."} ${u}`,
    "    REASON FOR DISCRETIONARY FUEL :....................",
    "12. NOTOC  / (DGR):",
    "13. REMARKS: NONE",
    "I HEREBY RELEASE THIS FLIGHT IN FULL COMPLIANCE WITH CIVIL AVIATION SAFETY",
    "REGULATIONS AND OPERATION MANUAL PART A (OM-A)",
    `    DISPATCHED BY               : FOO. ${text(crew, "dx").toUpperCase()} - ${fooId(text(params, "request_id"))}`,
    "I HEREBY PREPARE AND ARRANGE THIS FLIGHT DISPATCH RELEASE ACCORDING TO THE",
    "INSTRUCTION AND DATA PROVIDED BY INDONESIA JOURNEY VIRTUAL.",
    "    NAME / ID                   : .................. / ........",
    "                                   SIGN ......................",
    "I HEREBY ACCEPT THIS FLIGHT DISPATCH RELEASE WITH FULL ACKNOWLEDGEMENT.",
    `    PILOT IN COMMAND            :  CAPT. ${text(crew, "cpt").toUpperCase()}`,
    `                                   SIGN ${signed}`,
  ].join("\n")
}

const navHeader = [
  "ETO TIM   AWY     WPT/FRQ      TTK   DIS  TAS  FLV   TD /TP   FBO    PFRM",
  "ATO TIM      COORD             MTK   TTL  G/S  GMA   WIND     ABO    AFRM",
]

function navRows(fixes, { destination, destinationElevation, withFrequency = false, firs = false }) {
  let total = 0
  const rows = []
  const level = fix => text(fix, "stage") === "CLB" ? "CLB " : `${padL(Math.trunc(int(text(fix, "altitude_feet")) / 100), 3)} `
  const tail = fix => `${padL(text(fix, "true_airspeed"), 3)}  ${level(fix)}  ${padR(isa(fix), 7)} ${padL(text(fix, "fuel_totalused"), 5)}  ${padL(text(fix, "fuel_plan_onboard"), 6)}`
  const second = (fix, position, distance) => `    ${phpDate("Hi", text(fix, "time_total"))}    ${position}    ${text(fix, "track_mag")}M  ${distance} ${padL(text(fix, "groundspeed"), 3)}  ${padL(Math.trunc(int(text(fix, "mora")) / 100), 3)}   ${text(fix, "wind_dir")}${padL(text(fix, "wind_spd"), 3)}`
  for (const fix of fixes) {
    total += int(text(fix, "distance"))
    if (firs) for (const fir of list(fix.fir_crossing?.fir)) {
      rows.push(`    0000  ${padR(text(fix, "via_airway"), 6)} FIR/${text(fir, "fir_icao")}      ${text(fix, "track_true")}T  000  ${tail(fix)}`,
        second(fix, latLon(text(fir, "pos_lat_entry"), text(fir, "pos_long_entry")), "0000"))
    }
    const ident = withFrequency ? `${text(fix, "ident")} ${text(fix, "frequency")}`.trim() : text(fix, "ident")
    rows.push(`    ${phpDate("Hi", text(fix, "time_leg"))}  ${padR(text(fix, "via_airway"), 6)} ${padR(ident, 12)}  ${text(fix, "track_true")}T  ${padL(text(fix, "distance"), 3)}  ${tail(fix)}`,
      second(fix, latLon(text(fix, "pos_lat"), text(fix, "pos_long")), padL(total, 4)))
    if (text(fix, "ident") === destination) rows.push(`        ELEV ${elevation(destinationElevation)} FT`)
  }
  return rows
}

function windRow(fix) {
  const levels = new Map(list(fix.wind_data?.level).map(level => [text(level, "altitude"), level]))
  return padR(text(fix, "ident"), 7) + " " + ["10000", "18000", "24000", "30000", "34000", "39000", "45000"].map(altitude => {
    const data = levels.get(altitude)
    if (!data) return "......... "
    const oat = int(text(data, "oat"))
    return padR(`${padL(int(text(data, "wind_dir")), 3)}${padL(int(text(data, "wind_spd")), 3)}${oat < 0 ? "M" : "P"}${padL(Math.abs(oat), 2)}`, 10)
  }).join("")
}

// shortcut: the ETOPS ETP tables of the PDF are not rendered; add them when IJV dispatches ETOPS flights
export function cfpText(flight) {
  const { general = {}, origin = {}, destination = {}, times = {}, weights = {}, fuel = {}, aircraft = {}, params = {}, crew = {}, atc = {}, impacts = {} } = flight
  const fuelExtra = flight.fuel_extra && typeof flight.fuel_extra === "object" ? flight.fuel_extra : {}
  const u = unit(flight)
  const alts = alternates(flight)
  const fixes = list(flight.navlog?.fix)
  const altLog = [flight.alternate_navlog ?? []].flat()[0]
  const crz = cruiseProfile(text(general, "cruise_profile"), text(general, "costindex"))
  const fuelLine = (value, time, label) => `${padL(value, 6)}       .. ..     ${time}    ${label}`
  const tankering = [bucketFuel(fuelExtra, "TANKERING"), bucketTime(fuelExtra, "TANKERING")]
  const extra = [bucketFuel(fuelExtra, "EXTRA"), bucketTime(fuelExtra, "EXTRA")]
  const impact = key => impacts?.[key] && typeof impacts[key] === "object" ? impacts[key] : null
  const flRow = (ci, burn, time, level) => `${padR(ci, 13)}${padL(text(weights, "est_tow"), 6)}   ${padL(burn, 6)}      ${phpDate("H:i", time)}     ${level}`
  const altitudes = fixes.map(fix => text(fix, "altitude_feet")).filter(value => /^\d+$/.test(value)).map(Number)
  const eet = String(text(atc, "section18")).match(/EET\/([A-Z0-9\s]+)/)
  const windGroup = (title, stage, skip) => [title, "         FL100     FL180     FL240     FL300     FL340     FL390     FL450",
    ...fixes.filter(fix => text(fix, "stage") === stage && text(fix, "ident") !== skip).map(windRow), ""]
  const cpt = text(crew, "cpt").toUpperCase()
  return [
    rule, `${" ".repeat(24)}COMPUTERIZED FLIGHT PLAN`, rule,
    `PLAN ${text(params, "request_id").slice(-5)} / REV NUM ${padL(text(general, "release"), 2)}       ${text(origin, "icao_code")} TO ${text(destination, "icao_code")}  ${text(aircraft, "icaocode")}  ${crz}/F  IFR  ${phpDate("d/m/y", text(times, "sched_out"))}`,
    `NONSTOP COMPUTED ${phpDate("Hi", text(params, "time_generated"))} ETD ${phpDate("Hi", text(times, "sched_out"))}Z PROGS ${prognosisTimes(text(times, "sched_out"))} ${text(aircraft, "reg")} ${u}`,
    "", "INDONESIA JOURNEY VIRTUAL CFP", "",
    `SPD SKD   CLB-${text(general, "climb_profile")}  CRZ-${crz}   DSC-${text(general, "descent_profile")}`,
    "", "FUEL         CORR      ENDUR", "",
    fuelLine(text(fuel, "enroute_burn"), phpDate("H:i", text(times, "est_time_enroute")), `TRIPF INCL ${perfFactor(text(aircraft, "fuelfact"))}PCT HIGH CONS`),
    fuelLine(text(fuel, "contingency"), phpDate("H:i", text(times, "contfuel_time")), "CONTINGENCY/RR"),
    fuelLine(text(fuel, "reserve"), phpDate("H:i", text(times, "reserve_time")), "FINAL RESERVE FUEL"),
    ...(alts[0] ? [fuelLine(text(fuel, "alternate_burn"), phpDate("H:i", text(alts[0], "burn")), `ALTN ${text(alts[0], "icao_code")}`)] : []),
    fuelLine(bucketFuel(fuelExtra, "ATC"), phpDate("H:i", bucketTime(fuelExtra, "ATC")), "EXTRA HOLDING FUEL"),
    fuelLine(bucketFuel(fuelExtra, "WXX") + int(text(fuel, "etops")), phpDate("H:i", bucketTime(fuelExtra, "WXX") + int(text(times, "etopsfuel_time"))), "ADDITIONAL FUEL"),
    fuelLine(int(text(fuel, "plan_takeoff")) - tankering[0] - extra[0], phpDate("H:i", int(text(times, "endurance")) - tankering[1] - extra[1]), "REQ"),
    fuelLine(tankering[0], phpDate("H:i", tankering[1]), "TANKERING"),
    fuelLine(extra[0], phpDate("H:i", extra[1]), "DISCRETIONARY FUEL"),
    fuelLine(text(fuel, "plan_takeoff"), phpDate("H:i", text(times, "endurance")), "TKOF"),
    `${padL(text(fuel, "taxi"), 6)}       .. ..                 TAXI`,
    fuelLine(text(fuel, "plan_ramp"), phpDate("H:i", text(times, "endurance")), "BLOCK  FUEL REM .. .."),
    "",
    "                ARR  .. ..     TDN   .. ..",
    "                DEP  .. ..     A/B   .. ..",
    "                FLT  .. ..     AIR   .. ..",
    "",
    `FBURN ADJUSTMENT FOR 1000${u} INCR/DECR IN TOW ${padL(text(impact("zfw_plus_1000"), "burn_difference"), 4)}${u}/${padL(text(impact("zfw_minus_1000"), "burn_difference").replace("-", ""), 4)}${u}`,
    "", "FL SUMMARIES", "CRZ          TOW      TRF         TIM      FL",
    ...(impact("plus_2000ft") ? [flRow(cruiseProfile(text(general, "cruise_profile"), text(impact("plus_2000ft"), "cost_index")), text(impact("plus_2000ft"), "enroute_burn"), text(impact("plus_2000ft"), "time_enroute"), text(impact("plus_2000ft"), "initial_fl"))] : []),
    flRow(crz, text(fuel, "enroute_burn"), text(times, "est_time_enroute"), Math.trunc(int(text(general, "initial_altitude")) / 100)),
    ...(impact("minus_2000ft") ? [flRow(cruiseProfile(text(general, "cruise_profile"), text(impact("minus_2000ft"), "cost_index")), text(impact("minus_2000ft"), "enroute_burn"), text(impact("minus_2000ft"), "time_enroute"), text(impact("minus_2000ft"), "initial_fl"))] : []),
    "", `FLT NBR ${text(atc, "callsign")}   DTE ${phpDate("d/m/y", text(times, "sched_out"))}`, "",
    " EZF       PLD        ELW       ETW     CRZ",
    `${padL(text(weights, "est_zfw"), 6)}    ${padL(text(weights, "payload"), 6)}     ${padL(text(weights, "est_ldw"), 6)}    ${padL(text(weights, "est_tow"), 6)}   ${crz}`,
    "",
    ...navHeader, "",
    `        ${padR(text(origin, "icao_code"), 55)}${padL(text(fuel, "taxi"), 5)}  ${padL(text(fuel, "plan_takeoff"), 6)}`,
    `        ELEV ${elevation(text(origin, "elevation"))} FT`,
    `        ${latLon(text(origin, "pos_lat"), text(origin, "pos_long"))}`,
    ...navRows(fixes, { destination: text(destination, "icao_code"), destinationElevation: text(destination, "elevation"), firs: true }),
    "",
    eet ? `EET/${eet[1].trim()}` : "",
    "TRACK USED = -OPT", "",
    `G/C DIST ${text(origin, "icao_code")}/${text(destination, "icao_code")}  ${text(general, "gc_distance")} NM`, "",
    `ROUTE DIST ${text(general, "route_distance")}NM`, "",
    `MAX FL / AVG.TAS  ${altitudes.length ? `FL${padL(Math.trunc(Math.max(...altitudes) / 100), 3)}` : "N/A"} / ${int(text(general, "cruise_tas"))}`, "",
    `AVG COMP ${windComp(text(general, "avg_comp_wind") || text(general, "avg_wind_comp"))}`, "",
    "         GMA  DIST  TTK  W/C   FL   TIME   FUEL BOF",
    ...alts.flatMap(alt => [
      `${padR(text(alt, "icao_code"), 13)}${padL(text(alt, "distance"), 4)}  ${padL(text(alt, "track_true"), 3)}  ${text(alt, "avg_wind_comp")}  ${Math.trunc(int(text(alt, "cruise_altitude")) / 100)}  ${phpDate("H.i", text(alt, "ete"))}  ${padL(text(alt, "burn"), 6)}`,
      `         ${text(destination, "icao_code")} ${text(alt, "route_ifps")} ${text(alt, "icao_code")}`,
    ]),
    "", `${" ".repeat(29)}ALTERNATE DATA`, "",
    ...navHeader,
    ...navRows(list(altLog?.fix ?? altLog), { destination: text(alts[0], "icao_code"), destinationElevation: text(alts[0], "elevation"), withFrequency: true }),
    "",
    ...windGroup("CLIMB", "CLB", "TOC"), ...windGroup("CRUISE", "CRZ", "TOD"), ...windGroup("DESCENT", "DSC"),
    "I CERTIFY THAT HAVE SATISFIED MYSELF THAT ALL FACTORS WHICH FORM THE BASIS OF",
    "FLIGHT PREPARATION ARE IN ACCORDANCE WITH THE PERTINENT REGULATIONS LAID DOWN",
    `BY THE INDONESIAN CIVIL AVIATION, CAPTAIN ${cpt}`, "",
    `PIC             : CAPTAIN ${cpt}`, "",
    "SIGN            : .. .. .. .. .. ..", "",
    `PREPARED BY     : FOO. ${text(crew, "dx").toUpperCase()} - ${fooId(text(params, "request_id"))}`, "",
    "CAPTAINS SIGNATURE FOR COMPLETION OF JOURNAL AFTER FLIGHT", "",
    "                                      .. .. .. .. ..", "",
    ...String(text(atc, "flightplan_text")).split("\n").filter(Boolean), "",
    "END OF NAVTECH DATAPLAN",
    `REQUEST NO. ${text(params, "request_id").slice(-5)} / REV NBR ${text(general, "release")}`,
  ].join("\n")
}
