import assert from "node:assert/strict"
import test from "node:test"
import { briefingText, cfpText, cruiseProfile, fooId, isa, latLon, phpDate, releaseText, windComp } from "./ofp-text.js"

const out = Date.UTC(2026, 10, 16, 8, 30) / 1000
const flight = {
  params: { request_id: "1a2b3c4d5e6f7", time_generated: String(out - 3600), units: "kgs" },
  general: { icao_airline: "IJV", flight_number: "123", release: "2", costindex: "30", cruise_profile: "CI 30", avg_wind_comp: "-12", route_distance: "520", initial_altitude: "35000" },
  origin: { icao_code: "WIII", iata_code: "CGK", elevation: "34", pos_lat: "-6.1256", pos_long: "106.6559", taf: "TAF WIII", notam: [{ notam_id: "A0001/26", notam_text: "RWY 07L CLSD" }] },
  destination: { icao_code: "WADD", iata_code: "DPS", elevation: "14", taf: "TAF WADD" },
  alternate: { icao_code: "WARR", iata_code: "SUB", ete: "1800", burn: "1500" },
  times: { sched_out: String(out), est_in: String(out + 6300), est_block: "6300", est_time_enroute: "5400", reserve_time: "1800", endurance: "12600" },
  weights: { pax_count: "150", cargo: "1200", payload: "13950", est_zfw: "55000", max_zfw: "62500", est_tow: "62000", max_tow: "79000", est_ldw: "57000", max_ldw: "66000" },
  fuel: { taxi: "200", enroute_burn: "5000", contingency: "250", alternate_burn: "1500", reserve: "1100", plan_takeoff: "7900", plan_ramp: "8100" },
  aircraft: { reg: "PK-IJV", icaocode: "A320" },
  crew: { cpt: "Jane Doe", dx: "Lee" },
  atc: { callsign: "IJV123", flightplan_text: "(FPL-IJV123-IS\n-A320/M-SDE3FGHIJ1RWY/LB1)" },
  navlog: { fix: [
    { ident: "DIPUX", via_airway: "W45", stage: "CLB", distance: "40", time_leg: "600", time_total: "600", track_true: "95", track_mag: "94", true_airspeed: "380", groundspeed: "370", mora: "3400", wind_dir: "270", wind_spd: "15", oat_isa_dev: "5", fuel_totalused: "900", fuel_plan_onboard: "7000", pos_lat: "-6.5", pos_long: "107.25" },
    { ident: "WADD", via_airway: "DCT", stage: "DSC", altitude_feet: "0", distance: "480", time_leg: "4800", time_total: "5400", track_true: "100", track_mag: "99", true_airspeed: "420", groundspeed: "410", mora: "5000", wind_dir: "90", wind_spd: "5", oat_isa_dev: "-3", fuel_totalused: "5000", fuel_plan_onboard: "2900", pos_lat: "-8.748", pos_long: "115.167" },
  ] },
}

test("formatters follow the PDF template helpers", () => {
  assert.equal(phpDate("Hi", out), "0830")
  assert.equal(phpDate("dMy", out), "16NOV26")
  assert.equal(phpDate("H:i", 5400), "01:30")
  assert.equal(phpDate("Hi", ""), "")
  assert.equal(latLon(-6.1256, 106.6559), "S0607.5 E10639.4")
  assert.equal(isa({ oat_isa_dev: "5" }), "ISA+05")
  assert.equal(isa({ oat_isa_dev: "-3" }), "ISA-03")
  assert.equal(isa({}), "ISA")
  assert.equal(windComp("-12"), "M012")
  assert.equal(windComp("7"), "P007")
  assert.equal(cruiseProfile("CI 30", "30"), "CI030")
  assert.equal(cruiseProfile("M78", "30"), "M78")
  assert.equal(fooId("1a2b3c4d5e6f7"), 1000 + (0x1a2b3c4d % 9000))
  assert.equal(fooId(""), 1234)
})

test("dispatch release carries the crew entries", () => {
  const blank = releaseText(flight)
  assert.match(blank, /VALID U\/I 1430Z/)
  assert.match(blank, /REF PLAN 5e6f7 \/ REV NBR 2/)
  assert.match(blank, /IJV123 {3}16NOV26 ETD 0830Z {2}ETA 1015Z \/ FT 0145 IFR PK-IJV/)
  assert.match(blank, /AL1 SUB\/WARR {2}CHECKED/)
  assert.match(blank, /11\. FUEL REQ AFTER BRIEF: \.+ KGS/)
  assert.match(blank, /CAPT\. JANE DOE\n {35}SIGN \.+$/)
  const signed = releaseText(flight, { fuelReq: 8400, signedBy: "Jane Doe", signedAt: (out + 600) * 1000 })
  assert.match(signed, /11\. FUEL REQ AFTER BRIEF: 8400 KGS/)
  assert.match(signed, /SIGN JANE DOE 0840Z 16NOV26$/)
})

test("CFP lists the fuel plan, navlog and filed plan", () => {
  const text = cfpText(flight)
  assert.match(text, /PLAN 5e6f7 \/ REV NUM 02 {7}WIII TO WADD {2}A320 {2}CI030\/F {2}IFR {2}16\/11\/26/)
  assert.match(text, /^005000 {7}\.\. \.\. {5}01:30 {4}TRIPF INCL/m)
  assert.match(text, /^001500 {7}\.\. \.\. {5}00:25 {4}ALTN WARR/m)
  assert.match(text, /^ {4}0010 {2}W45 {4}DIPUX {9}95T {2}040 {2}380 {2}CLB {3}ISA\+05 {2}00900 {2}007000$/m)
  assert.match(text, /^ {4}0010 {4}S0630\.0 E10715\.0 {4}94M {2}0040 370 {2}034 {3}270015$/m)
  assert.match(text, /^ {4}0130 {4}S0844\.9 E11510\.0 {4}99M {2}0520 410/m)
  assert.match(text, /ELEV 0014 FT/)
  assert.match(text, /\(FPL-IJV123-IS/)
  assert.doesNotThrow(() => cfpText({}))
  assert.doesNotThrow(() => briefingText({}))
  assert.doesNotThrow(() => releaseText({}))
})

test("briefing text lists NOTAMs and forecasts per airport", () => {
  const text = briefingText(flight)
  assert.match(text, /IJV123 WIII-WADD PK-IJV 16\/11\/26/)
  assert.match(text, /WIII\/CGK {2}STD 0830Z\nNOTAM:\nA0001\/26\nRWY 07L CLSD\nFORECAST WEATHER:\nTAF WIII/)
  assert.match(text, /WADD\/DPS {2}ETA 1015Z\nNOTAM:\nNO SIGNIFICANT NOTAM\./)
  assert.match(text, /WARR\/SUB {2}ETA \(ALTN\) 1045Z/)
  assert.match(text, /WIND COMP\. {3}: M012/)
  assert.match(text, /PAYLOAD {6}: 13950 KGS/)
})
