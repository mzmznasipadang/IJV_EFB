const earthRadiusNm = 3440.065
const toRad = Math.PI / 180
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const weatherOrder = ["VFR", "MVFR", "unknown", "IFR", "LIFR"]
// VFR and MVFR rank equally so distance decides between them; IFR/LIFR rank lower because approach availability is unknown
const weatherTier = { VFR: 0, MVFR: 0, unknown: 1, IFR: 2, LIFR: 3 }

export function distanceNm([lat1, lon1], [lat2, lon2]) {
  const h = Math.sin((lat2 - lat1) * toRad / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin((lon2 - lon1) * toRad / 2) ** 2
  return 2 * earthRadiusNm * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Average planned burn over the whole route, climb included
export function burnPerNm(legs) {
  const first = legs[0]?.fuel
  const last = legs.at(-1)?.fuel
  const distance = legs.at(-1)?.totalDistance
  if (first == null || last == null || !(distance > 0) || first <= last) return null
  return (first - last) / distance
}

// Where the aircraft is assumed to be: crew pick, else the latest primary waypoint with an ATO, else departure
export function diversionPosition(legs, entries, selected = null) {
  let index = selected != null && legs[selected]?.position ? selected : -1
  let source = "Selected waypoint"
  if (index < 0) {
    index = legs.findLastIndex((leg, i) => leg.position && entries[`p:${i}`]?.ato)
    source = "Latest Navlog ATO"
  }
  if (index < 0) {
    index = legs.findIndex(leg => leg.position)
    source = "Departure — no ATO entered"
  }
  if (index < 0) return null
  const actual = entries[`p:${index}`]?.fuel
  const hasActual = typeof actual === "number"
  return { index, leg: legs[index], source, fuelOnBoard: hasActual ? actual : legs[index].fuel, fuelPlanned: !hasActual }
}

export function rankDiversions(candidates, { position, fuelOnBoard, burnPerNm, minRunwayFt = 6000, finalReserve, wx = {}, unit }) {
  const fuelUnit = unit ? ` ${unit}` : ""
  return candidates.map(airport => {
    const distance = distanceNm(position, [airport.lat, airport.lon])
    const longestRunway = (airport.runways ?? []).filter(runway => !runway.closed && runway.lengthFt > 0)
      .reduce((best, runway) => !best || runway.lengthFt > best.lengthFt ? runway : best, null)
    const eligible = longestRunway?.lengthFt >= minRunwayFt
    const fuelOnLanding = fuelOnBoard != null && burnPerNm != null ? fuelOnBoard - burnPerNm * distance : null
    const belowReserve = fuelOnLanding != null && finalReserve != null && fuelOnLanding < finalReserve
    const category = weatherOrder.includes(wx[airport.icao]?.fltCat) ? wx[airport.icao].fltCat : "unknown"
    const reasons = [
      eligible ? `Longest runway ${count.format(longestRunway.lengthFt)} ft` : `No open runway of ${count.format(minRunwayFt)} ft or more`,
      fuelOnLanding == null ? "Fuel on landing unknown" : `Est. ${count.format(fuelOnLanding)}${fuelUnit} on landing`,
      belowReserve && `Below ${count.format(finalReserve)}${fuelUnit} final reserve`,
      category === "unknown" ? "No METAR category" : `${category} at last METAR`,
    ].filter(Boolean)
    // Lower is better: eligibility, then reserve (known ok, unknown, below), then weather, then distance (< 10,000 NM)
    const fuelTier = belowReserve ? 2 : fuelOnLanding == null || finalReserve == null ? 1 : 0
    const score = (eligible ? 0 : 1e6) + fuelTier * 1e5 + weatherTier[category] * 1e4 + distance
    return { airport, distanceNm: distance, longestRunway, fuelOnLanding, category, eligible, reasons, score }
  }).sort((a, b) => a.score - b.score)
}
