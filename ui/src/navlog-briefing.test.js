import assert from "node:assert/strict"
import { test } from "node:test"
import { notamMapAreas, sigmetMapAreas } from "./navlog-briefing.js"

const now = Date.parse("2026-11-16T12:00:00Z")
const report = (id, qLine, end = "2611171200") =>
  `${id} NOTAMN\nQ) WIII/QRTCA/IV/BO/W/000/120/${qLine}\nA) WIII B) 2611161000 C) ${end}\nE) TEST AIRSPACE`

test("NOTAM areas combine matching v2 and airport notices and require valid Q-lines", () => {
  const raw = report("A1234/26", "0615S10645E005")
  const flight = {
    origin: { notam: [{ notam_raw: raw, date_effective: "2026-11-16T10:00:00Z", date_expire: "2026-11-17T12:00:00Z" }] },
    notams: [
      { notam_report: raw, notam_effective_dtg: "202611161000", notam_expire_dtg: "202611171200" },
      { notam_report: report("A1235/26", "0615S10645E005", "PERM"), notam_effective_dtg: "202611161000" },
      { notam_report: report("A1236/26", "0660S10645E005") },
      { notam_report: report("A1237/26", "0615S10645E999") },
      { notam_report: report("A1238/26", "0615S10645E005"), notam_expire_dtg: "202611161200" },
      { notam_report: report("A1239/26", "0615S10645E005"), notam_effective_dtg: "202611161201" },
      { notam_report: report("A1240/26", "0615S10645E005").replace("NOTAMN", "NOTAMC") },
      { notam_text: "E) RWY CLSD" },
    ],
  }
  const areas = notamMapAreas(flight, 105, now)
  assert.equal(areas.length, 1)
  assert.deepEqual(areas[0].position, [-6.25, 106.75])
  assert.equal(areas[0].radiusNm, 5)
  assert.deepEqual(areas[0].notices.map(notice => notice.id), ["A1234/26", "A1235/26"])
})

test("SIGMET areas include valid multipart and date-line polygons", () => {
  const start = now / 1000 - 30
  const end = now / 1000 + 60
  const ring = [{ lat: 1, lon: 179 }, { lat: 1, lon: -179 }, { lat: 2, lon: 181 }]
  const reports = [
    { firId: "TEST", hazard: "TS", geom: "AREAS", coords: [ring, [...ring, { lat: null, lon: 180 }]], validTimeFrom: start, validTimeTo: end },
    { geom: "AREA", coords: ring, validTimeFrom: start, validTimeTo: now / 1000 },
    { geom: "AREA", coords: ring, validTimeFrom: now / 1000 + 1, validTimeTo: end },
  ]
  const areas = sigmetMapAreas(reports, 179, now)
  assert.equal(areas.length, 1)
  assert.deepEqual(areas[0].polygons, [[[1, 179], [1, 181], [2, 181]]])
})
