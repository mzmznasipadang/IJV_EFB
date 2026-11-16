import assert from "node:assert/strict"
import { test } from "node:test"
import { burnPerNm, distanceNm, diversionPosition, rankDiversions } from "./diversion.js"

test("distanceNm is a great-circle distance in NM", () => {
  // WIII (Jakarta) to WADD (Bali)
  assert.ok(Math.abs(distanceNm([-6.1256, 106.6559], [-8.7482, 115.1672]) - 520) < 15)
  assert.equal(distanceNm([10, 20], [10, 20]), 0)
  assert.ok(Math.abs(distanceNm([0, 0], [1, 0]) - 60) < 0.1)
})

test("burnPerNm uses planned fuel over total route distance", () => {
  assert.equal(burnPerNm([{ fuel: 10000, totalDistance: 0 }, { fuel: 7000, totalDistance: 200 }, { fuel: 4000, totalDistance: 600 }]), 10)
  assert.equal(burnPerNm([{ fuel: 10000, totalDistance: 0 }, { fuel: 4000, totalDistance: null }]), null)
  assert.equal(burnPerNm([{ fuel: null, totalDistance: 0 }, { fuel: 4000, totalDistance: 600 }]), null)
  assert.equal(burnPerNm([]), null)
})

test("diversionPosition prefers a selection, then the latest ATO, then departure", () => {
  const legs = [
    { ident: "WIII", position: [-6, 106], fuel: 10000 },
    { ident: "A", position: [-7, 108], fuel: 8000 },
    { ident: "B", position: null, fuel: 7000 },
    { ident: "C", position: [-8, 112], fuel: 6000 },
  ]
  assert.deepEqual(diversionPosition(legs, {}), { index: 0, leg: legs[0], source: "Departure — no ATO entered", fuelOnBoard: 10000, fuelPlanned: true })
  const entries = { "p:1": { ato: "0130", fuel: 7800 }, "p:2": { ato: "0140" } }
  assert.deepEqual(diversionPosition(legs, entries), { index: 1, leg: legs[1], source: "Latest Navlog ATO", fuelOnBoard: 7800, fuelPlanned: false })
  assert.equal(diversionPosition(legs, entries, 3).source, "Selected waypoint")
  assert.equal(diversionPosition(legs, entries, 3).fuelOnBoard, 6000)
  assert.equal(diversionPosition(legs, entries, 2).source, "Latest Navlog ATO")
  assert.equal(diversionPosition([{ ident: "X", position: null }], {}), null)
})

const runway = (lengthFt, closed = false) => ({ ident: "09/27", lengthFt, widthFt: 150, surface: "ASP", lighted: true, closed })
const airport = (icao, lat, runways) => ({ icao, name: icao, lat, lon: 0, elevationFt: 0, type: "medium_airport", runways })

test("rankDiversions orders by runway, reserve, weather then distance", () => {
  const candidates = [
    airport("NEAR", 1, [runway(5000), runway(9000, true)]), // 60 NM, only short open runway
    airport("IFRA", 2, [runway(8000)]), // 120 NM, IFR
    airport("VFRA", 3, [runway(7000)]), // 180 NM, VFR
    airport("NOWX", 4, [runway(7000)]), // 240 NM, no METAR
    airport("FARA", 9, [runway(12000)]), // 540 NM, below reserve
  ]
  const ranked = rankDiversions(candidates, {
    position: [0, 0], fuelOnBoard: 6000, burnPerNm: 10, minRunwayFt: 6000, finalReserve: 1200, unit: "kg",
    wx: { IFRA: { fltCat: "IFR" }, VFRA: { fltCat: "VFR" }, FARA: { fltCat: "VFR" } },
  })
  assert.deepEqual(ranked.map(r => r.airport.icao), ["VFRA", "NOWX", "IFRA", "FARA", "NEAR"])
  const close = rankDiversions([airport("MVFR", 1, [runway(7000)]), airport("VFRB", 3, [runway(7000)])],
    { position: [0, 0], fuelOnBoard: 9000, burnPerNm: 5, finalReserve: 1000, wx: { MVFR: { fltCat: "MVFR" }, VFRB: { fltCat: "VFR" } } })
  assert.deepEqual(close.map(r => r.airport.icao), ["MVFR", "VFRB"])
  const near = ranked.at(-1)
  assert.equal(near.eligible, false)
  assert.equal(near.longestRunway.lengthFt, 5000)
  assert.equal(near.reasons[0], "No open runway of 6,000 ft or more")
  const far = ranked[3]
  assert.ok(Math.abs(far.fuelOnLanding - 600) < 10)
  assert.ok(far.reasons.includes("Below 1,200 kg final reserve"))
  const [runwayReason, fuelReason, ...rest] = ranked[0].reasons
  assert.equal(runwayReason, "Longest runway 7,000 ft")
  assert.match(fuelReason, /^Est\. 4,19\d kg on landing$/)
  assert.deepEqual(rest, ["VFR at last METAR"])
  assert.equal(ranked[1].category, "unknown")
})

test("rankDiversions handles missing fuel data and runways", () => {
  const [result] = rankDiversions([airport("NORW", 1, undefined)], { position: [0, 0], fuelOnBoard: null, burnPerNm: 10 })
  assert.equal(result.eligible, false)
  assert.equal(result.longestRunway, null)
  assert.equal(result.fuelOnLanding, null)
  assert.ok(result.reasons.includes("Fuel on landing unknown"))
})
