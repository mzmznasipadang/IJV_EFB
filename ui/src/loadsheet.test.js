import assert from "node:assert/strict"
import { test } from "node:test"
import { dispatchTiming, enrouteDuration, importDispatch, loadDispatch } from "./dispatch.js"
import { loadsheetText, loadsheetTelex } from "./loadsheet.js"

const epoch = iso => Date.parse(iso) / 1000
const out = epoch("2026-10-26T23:55Z")
const arrival = epoch("2026-10-27T01:25Z")
const flight = {
  params: { time_generated: epoch("2026-10-26T20:00Z"), units: "lbs" },
  origin: { iata_code: "CGK", icao_code: "WIII" }, destination: { icao_code: "WARR" },
  general: { icao_airline: "GA", flight_number: "324", release: "1" },
  times: { est_out: "0", sched_out: { value: String(out) }, est_in: String(arrival), est_time_enroute: "4200", est_block: "5400" },
  weights: { pax_count: "0", est_zfw: "56146", est_tow: "62000", est_ldw: "58200", payload: "" },
  fuel: { plan_ramp: "6000" },
}

test("flight timing prefers estimates, falls back to schedules, and uses airborne time separately", () => {
  assert.deepEqual(dispatchTiming(flight), { etd: out, eta: arrival, ete: 4200 })
  assert.deepEqual(dispatchTiming({ times: { est_out: -1, est_in: "bad", sched_in: arrival, est_block: 5400 } }),
    { etd: null, eta: arrival, ete: null })
  assert.equal(enrouteDuration(25 * 3600 + 5 * 60), "25:05")
})

test("planned loadsheet retains UTC, source units, and missing data without treating zero as missing", () => {
  const text = loadsheetText(flight)
  assert.match(text, /^LOADSHEET 26OCT26\n2000Z  E1  LBS\nGA324\/26 CGK WARR\nPLANNED WEIGHTS\n/)
  assert.match(text, /^TOB +N\/A\nZFW +56146\nMACZFW +N\/A\nMACTOW +N\/A$/m)
  assert.match(text, /^PAX \(PLN\) +0$/m)
  assert.match(text, /^PAYLOAD\(PLN\) +N\/A$/m)
  assert.match(text, /ETD 2355Z  ETA 0125Z\nETE 01:10$/)
})

test("crew loadsheet only uses complete actuals and does not relabel estimated landing weight", () => {
  assert.equal(loadsheetText(flight, { zfw: 55000, tow: 61500, ramp: "" }), loadsheetText(flight))
  const text = loadsheetText(flight, { zfw: 55000, tow: 61500, ramp: 5500 })
  assert.match(text, /^CREW ACTUAL WEIGHTS$/m)
  assert.match(text, /^ZFW +55000$/m)
  assert.match(text, /^TOW +61500\nEST LDW +58200\nRAMP FUEL +5500$/m)
})

test("planned cockpit telex keeps each field together without padding or unavailable values", () => {
  assert.equal(loadsheetTelex({ ...flight, atc: { callsign: "GIA324" } }),
    "IJV PLANNED LOADSHEET GIA324 CGK-WARR LBS ZFW:56146 TOW:62000 LDW:58200 RAMP:6000 PAX:0 ETD:2355Z ETA:0125Z ETE:01:10")
})

test("crew cockpit telex uses crew weights and labels the remaining planned values", () => {
  assert.equal(loadsheetTelex(flight, { zfw: 55000, tow: 61500, ramp: 5500 }),
    "IJV CREW LOADSHEET GA324 CGK-WARR LBS ZFW:55000 TOW:61500 ELDW:58200 RAMP:5500 PLN-PAX:0 ETD:2355Z ETA:0125Z ETE:01:10")
})

test("live SimBrief v2 timestamps and durations survive import and cached loadsheet rendering", async t => {
  const raw = {
    ...flight,
    params: { ...flight.params, time_generated: "2026-10-26T20:00:00Z" },
    times: { est_out: "2026-10-26T23:55:00Z", est_in: "2026-10-27T01:25:11Z", est_time_enroute: "01:10:11", orig_timezone: "+07:00:00" },
  }
  t.mock.method(globalThis, "fetch", async () => Response.json(raw))
  const imported = await importDispatch("12345")
  const packed = JSON.stringify({ flight: raw, savedAt: Date.now() })
  const storage = { getItem: () => packed, removeItem: () => {} }
  const cached = loadDispatch(storage, "dispatch", out * 1000).flight
  for (const plan of [imported, cached]) {
    const telex = loadsheetText(plan)
    assert.match(telex, /^LOADSHEET 26OCT26\n2000Z/)
    assert.match(telex, /ETD 2355Z  ETA 0125Z\nETE 01:10$/)
    assert.equal(plan.times.orig_timezone, "+07:00:00")
  }
  assert.equal(loadDispatch(storage, "dispatch", epoch("2026-10-29T20:00Z") * 1000), null)
})
