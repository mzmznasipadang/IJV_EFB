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
