import assert from "node:assert/strict"
import { test } from "node:test"
import { flightNotams, rankNotams } from "./dispatch.js"

test("rankNotams puts urgent first, drops duplicates, accepts a single object", () => {
  const ranked = rankNotams([
    { notam_id: "A1", notam_text: "BIRD ACTIVITY" },
    { notam_id: "A2", notam_text: "RWY 07L CLSD" },
    { notam_id: "A2", notam_text: "RWY 07L CLSD" },
  ])
  assert.deepEqual(ranked.map(n => [n.notam_id, n.score]), [["A2", 2], ["A1", 0]])
  assert.equal(rankNotams({ notam_id: "B1", notam_raw: "ILS U/S" })[0].score, 2)
  assert.deepEqual(rankNotams(undefined), [])
})

test("flightNotams groups by airport role", () => {
  const groups = flightNotams({
    origin: { icao_code: "WIII", notam: [{ notam_id: "X", notam_text: "TWY CLSD" }] },
    destination: { icao_code: "WIKK", notam: { notam_id: "Y", notam_text: "OBST" } },
    alternate: { icao_code: "WIPP" },
  })
  assert.deepEqual(groups.map(g => [g.code, g.role, g.notams.length]), [["WIII", "Departure", 1], ["WIKK", "Destination", 1], ["WIPP", "Alternate", 0]])
})

test("navlog legs keep fix order and distinguish zero from missing data", async () => {
  const { navlogLegs } = await import("./dispatch.js")
  const log = { fix: [
    { ident: "WIII", time_total: "0" },
    { ident: { value: "TOC" }, via_airway: "DCT", altitude_feet: "31000", track_mag: "005",
      distance: "20.5", time_total: "600", fuel_plan_onboard: "5000" },
    { ident: "TOD", distance: "10" },
    { ident: "WIPP", distance: "", fuel_plan_onboard: "0" },
    { ident: "NEXT", distance: "2" },
  ] }
  const legs = navlogLegs(log, "WIII")
  assert.deepEqual(legs.map(leg => leg.ident), ["WIII", "TOC", "TOD", "WIPP", "NEXT"])
  assert.deepEqual(legs.map(leg => leg.totalDistance), [0, 20.5, 30.5, null, null])
  assert.deepEqual(legs[1], {
    ident: "TOC", airway: "DCT", altitude: 31000, track: 5,
    distance: 20.5, totalDistance: 20.5, elapsed: 600, fuel: 5000, position: null,
  })
  assert.equal(legs[0].elapsed, 0)
  assert.equal(legs[0].track, null)
  assert.equal(legs[3].fuel, 0)
  assert.equal(navlogLegs({ fix: { ident: "WIPP", distance: "15" } })[0].totalDistance, 15)
  assert.equal(navlogLegs({ fix: { ident: "WIPP" } }, "WIII")[0].totalDistance, null)
  assert.deepEqual(navlogLegs({ fix: [null, {}, { ident: "" }] }), [])
  assert.deepEqual(navlogLegs(null), [])
})

test("navlog handles SimBrief v2 fix arrays and alternate routes", async () => {
  const { navlogLegs, alternateNavlogLegs } = await import("./dispatch.js")
  const main = [{ ident: "WIII", distance: "0" }, { ident: "WIPP", distance: "110" }]
  const firstAlternate = [{ ident: "WIPP", distance: "0" }, { ident: "WIKK", distance: "96" }]
  const secondAlternate = [{ ident: "WIPT", distance: "220" }]
  assert.deepEqual(navlogLegs(main, "WIII").map(leg => leg.ident), ["WIII", "WIPP"])
  for (const data of [[firstAlternate, secondAlternate], [{ fix: firstAlternate }, { fix: secondAlternate }]]) {
    assert.deepEqual(alternateNavlogLegs(data, "WIPP").map(legs => legs.map(leg => leg.ident)), [["WIPP", "WIKK"], ["WIPT"]])
  }
  assert.deepEqual(alternateNavlogLegs(firstAlternate, "WIPP"), alternateNavlogLegs({ fix: firstAlternate }, "WIPP"))
  assert.equal(alternateNavlogLegs([firstAlternate], "WIPP")[0].at(-1).totalDistance, 96)
})

test("navlog map preserves coordinate gaps and wraps routes at the date line", async () => {
  const { navlogLegs, navlogMapRoutes } = await import("./dispatch.js")
  const primary = navlogLegs([
    { ident: "WEST", pos_lat: "0", pos_long: { value: "179" } },
    { ident: "EAST", pos_lat: "1", pos_long: "-179" },
    { ident: "MISSING", pos_lat: "  ", pos_long: "0" },
    { ident: "INVALID", pos_lat: "91", pos_long: "-177" },
    { ident: "ARR", pos_lat: "3", pos_long: "-178" },
  ])
  const alternate = navlogLegs([{ ident: "ALT", pos_lat: 2, pos_long: -176 }])
  assert.deepEqual(primary.map(leg => leg.position), [[0, 179], [1, -179], null, null, [3, -178]])
  assert.deepEqual(navlogMapRoutes(primary, [alternate]).map(({ alternate, segments }) => ({ alternate, segments })), [
    { alternate: false, segments: [[[0, 179], [1, 181]], [[3, 182]]] },
    { alternate: true, segments: [[[2, 184]]] },
  ])
  assert.deepEqual(navlogMapRoutes([], [primary.slice(2, 4)]), [])
})

test("windMatrix groups by stage, skips TOC/TOD, picks levels and nearest column", async () => {
  const { windMatrix } = await import("./dispatch.js")
  const level = (altitude, wind_dir, wind_spd, oat) => ({ altitude: String(altitude), wind_dir, wind_spd, oat })
  const groups = windMatrix({ navlog: { fix: [
    { ident: "AAA", stage: "CLB", altitude_feet: "17000", wind_data: { level: [level(10000, "62", "7", "10"), level(18000, "318", "4", "-4")] } },
    { ident: "TOC", stage: "CLB", altitude_feet: "35000" },
    { ident: "BBB", stage: "CRZ", altitude_feet: "35000", wind_data: { level: level(34000, "240", "35", "-48") } },
    { ident: "TOD", stage: "CRZ" },
  ] } })
  assert.deepEqual(groups.map(g => [g.label, g.rows.map(r => r.ident)]), [["Climb", ["AAA"]], ["Cruise", ["BBB"]]])
  assert.deepEqual(groups[0].rows[0].cells.slice(0, 3), [{ dir: 62, spd: 7, oat: 10 }, { dir: 318, spd: 4, oat: -4 }, null])
  assert.equal(groups[0].rows[0].nearest, 1)
  assert.deepEqual(groups[1].rows[0].cells[4], { dir: 240, spd: 35, oat: -48 })
  assert.deepEqual(windMatrix(null), [])
})

test("dispatch cache restores within 48 h of generation and drops older or corrupt entries", async () => {
  const { saveDispatch, loadDispatch } = await import("./dispatch.js")
  const store = new Map()
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) }
  const generated = 1_794_410_139
  const flight = { params: { time_generated: String(generated) } }
  saveDispatch(storage, "k", flight, [{ id: 1 }])
  assert.deepEqual(loadDispatch(storage, "k", generated * 1000 + 47 * 3600e3).manifest, [{ id: 1 }])
  assert.equal(loadDispatch(storage, "k", generated * 1000 + 49 * 3600e3), null)
  assert.equal(store.has("k"), false)
  store.set("k", "{not json")
  assert.equal(loadDispatch(storage, "k"), null)
  saveDispatch({ setItem() { throw new Error("QuotaExceeded") } }, "k", flight, [])
})

test("routeSigmets keeps valid SIGMETs that contain a fix at a level inside base/top", async () => {
  const { routeSigmets, sigmetTelex } = await import("./dispatch.js")
  const box = [{ lat: -9, lon: 112 }, { lat: -9, lon: 114 }, { lat: -7, lon: 114 }, { lat: -7, lon: 112 }, { lat: -9, lon: 112 }]
  const flight = { navlog: { fix: [{ pos_lat: "-8", pos_long: "113", altitude_feet: "35000" }, { pos_lat: "-2", pos_long: "106", altitude_feet: "35000" }] } }
  const sigmet = { firId: "WAAF", seriesId: "03", hazard: "TS", coords: box, base: 0, top: 45000, validTimeFrom: 100, validTimeTo: 1000 }
  assert.equal(routeSigmets(flight, [sigmet], 500).length, 1)
  assert.equal(routeSigmets(flight, [{ ...sigmet, top: 15000 }], 500).length, 0, "below cruise level")
  assert.equal(routeSigmets(flight, [{ ...sigmet, coords: box.map(p => ({ ...p, lon: p.lon + 20 })) }], 500).length, 0, "off route")
  assert.equal(routeSigmets(flight, [sigmet], 2000).length, 0, "expired")
  assert.match(sigmetTelex(sigmet), /^IJV OPS SIGWX ALERT ON ROUTE: WAAF SIGMET 03 TS SFC\/FL450 VALID 0001-0016Z$/)
})

test("oooiTimes reads OOOI from downlinks only, latest wins", async () => {
  const { oooiTimes } = await import("./dispatch.js")
  assert.deepEqual(oooiTimes([
    { dir: "down", text: "WIII/WSSS OUT/0512" },
    { dir: "up", text: "IN 9999" },
    { dir: "down", text: "OFF/0520 ETA/0710" },
    { dir: "down", text: "OUT 0515" },
  ]), { OUT: "0515", OFF: "0520" })
})

test("telex builders produce uppercase summaries", async () => {
  const { ofpTelex, notamTelex } = await import("./dispatch.js")
  const flight = { general: { icao_airline: "IJV", flight_number: "807", initial_altitude: "35000", route: "dct" },
    origin: { icao_code: "WIII", notam: [{ notam_id: "1", notam_text: "rwy 07L clsd" }] }, destination: { icao_code: "WIKK" },
    times: { sched_out: "0" }, fuel: { plan_ramp: "5200" }, weights: { est_zfw: "52000" }, params: { units: "kgs" } }
  assert.match(ofpTelex(flight), /^IJV OPS OFP IJV807 WIII-WIKK ETD ---- .*CRZ FL350 BLOCK FUEL 5200 ZFW 52000 .* KGS .*RTE DCT$/)
  assert.equal(notamTelex(flight), "IJV OPS NOTAM DIGEST WIII: RWY 07L CLSD WIKK: NIL URGENT")
})

test("navlog entries belong to one dispatch and survive reloads", async () => {
  const { dispatchId, loadNavlogEntries, saveNavlogEntries } = await import("./dispatch.js")
  const store = new Map()
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) }
  const a = dispatchId({ params: { request_id: "111", time_generated: "9" } })
  assert.equal(a, "111")
  assert.equal(dispatchId({ params: { time_generated: "9" } }), "9")
  saveNavlogEntries(storage, "k", a, { "p:0": { fuel: 5000 }, "a0:0": { note: "alt" } })
  assert.deepEqual(loadNavlogEntries(storage, "k", a), { "p:0": { fuel: 5000 }, "a0:0": { note: "alt" } })
  assert.deepEqual(loadNavlogEntries(storage, "k", "222"), {})
  assert.deepEqual(loadNavlogEntries(storage, "k", ""), {})
  store.set("k", "{bad")
  assert.deepEqual(loadNavlogEntries(storage, "k", a), {})
})

test("navlog entry validation", async () => {
  const { validUtcTime, parseFuel, dispatchFuelUnit } = await import("./dispatch.js")
  assert.deepEqual(["2359", "0000", "", "2400", "0960", "123", "12:30"].map(validUtcTime), [true, true, true, false, false, false, false])
  const flight = { fuel: { plan_ramp: "10000" } }
  assert.deepEqual(["4500", " 4500.5 ", "", "-1", "abc", "15000", "15001"].map(v => parseFuel(v, flight)), [4500, 4500.5, "", null, null, 15000, null])
  assert.equal(parseFuel("99999", {}), 99999)
  assert.deepEqual(["kgs", "LBS", "kg", ""].map(units => dispatchFuelUnit({ params: { units } })), ["kg", "lb", "kg", null])
})

test("fuel status, destination estimate and fuel-check reminder", async () => {
  const { fuelStatus, fuelCheckDue, plannedEto, takeoffTime } = await import("./dispatch.js")
  const legs = [{ fuel: 9000, elapsed: 0 }, { fuel: 8000, elapsed: 600 }, { fuel: 6000, elapsed: 1800 }, { fuel: 3000, elapsed: 3600 }]
  assert.equal(fuelStatus(legs, {}).destinationEstimate, null)
  const status = fuelStatus(legs, { "p:1": { fuel: 7900 }, "p:2": { fuel: 5800 }, "a0:2": { fuel: 1 } })
  assert.deepEqual(status.rows.map(row => row.deviation), [null, -100, -200, null])
  assert.equal(status.latest.index, 2)
  assert.equal(status.destinationEstimate, 2800)
  assert.equal(fuelCheckDue(legs, {}, 1000, 1000 + 700), 1)
  assert.equal(fuelCheckDue(legs, { "p:1": { fuel: 7900 } }, 1000, 1000 + 700), -1)
  assert.equal(fuelCheckDue(legs, { "p:1": { fuel: 7900 } }, 1000, 1000 + 2000), 2)
  assert.equal(fuelCheckDue(legs, {}, null), -1)
  assert.equal(takeoffTime({ times: { est_out: "3600", taxi_out: "600" } }), 4200)
  assert.equal(takeoffTime({ times: { est_off: "4000", est_out: "3600" } }), 4000)
  assert.equal(plannedEto(4200, 600), "0120")
  assert.equal(plannedEto(null, 600), "")
})
