import { longitudeNear } from "./dispatch.js"

function utcText(time) {
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 16).replace("T", " ") + "Z" : "PERM"
}

function notamTime(value) {
  const text = String(value ?? "").trim()
  if (text === "PERM") return Infinity
  const compact = /^\d{10}$/.test(text) ? `20${text}` : text
  const match = compact.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  return Date.parse(match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00Z` : text)
}

const qLine = /(?:^|\s)Q\)\s*([A-Z0-9]{4})(?:\s*\/[^/\r\n]+){6}\/\s*(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})\b/i

export function notamMapAreas(flight, reference, now = Date.now()) {
  const nearby = [flight.origin, flight.destination, ...[flight.alternate ?? []].flat()]
    .flatMap(airport => [airport?.notam ?? []].flat())
  const issued = [flight.notams?.notam ?? flight.notams ?? []].flat()
  const groups = new Map()
  const seen = new Set()
  for (const notice of [...nearby, ...issued]) {
    const reports = [notice?.notam_raw, notice?.notam_report, notice?.notam_text]
    const report = reports.find(text => typeof text === "string" && qLine.test(text))
    if (!report || /^(?:NOTAM)?C$/i.test(notice.notam_nrc ?? "") || /\bNOTAMC\b/i.test(report)) continue
    const [, fir, latDegrees, latMinutes, ns, lonDegrees, lonMinutes, ew, radius] = report.match(qLine)
    const start = notamTime(notice.date_effective || notice.notam_effective_dtg || report.match(/\bB\)\s*(\d{10})\b/i)?.[1])
    const end = notamTime(notice.date_expire || notice.notam_expire_dtg || report.match(/\bC\)\s*(\d{10}|PERM)\b/i)?.[1])
    if (!(start <= now && end > now) || +latMinutes >= 60 || +lonMinutes >= 60 || +radius === 999) continue
    const lat = (+latDegrees + latMinutes / 60) * (ns.toUpperCase() === "S" ? -1 : 1)
    const lon = (+lonDegrees + lonMinutes / 60) * (ew.toUpperCase() === "W" ? -1 : 1)
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const id = report.match(/\b[A-Z]\d{4}\/\d{2}\b/i)?.[0] || notice.notam_id
    const key = `${fir}:${id ?? report}`
    if (seen.has(key)) continue
    seen.add(key)
    const areaKey = `${lat}:${lon}:${radius}`
    if (!groups.has(areaKey)) groups.set(areaKey, { position: [lat, longitudeNear(lon, reference)], radiusNm: +radius, notices: [] })
    groups.get(areaKey).notices.push({ id: id ?? "NOTAM", times: `${utcText(start)} – ${utcText(end)}`, report })
  }
  return [...groups.values()]
}

function level(value) {
  if (value == null || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0) return "Unknown"
  return Number(value) === 0 ? "SFC" : `FL${String(Math.round(value / 100)).padStart(3, "0")}`
}

function polygonAround(ring, reference) {
  if (!Array.isArray(ring)) return []
  let longitude = reference
  const polygon = []
  for (const point of ring) {
    if (!Number.isFinite(point?.lat) || Math.abs(point.lat) > 90 ||
      !Number.isFinite(point.lon) || Math.abs(point.lon) > 360) return []
    longitude = longitudeNear(point.lon, longitude)
    polygon.push([point.lat, longitude])
  }
  return new Set(polygon.map(point => point.join(","))).size >= 3 ? polygon : []
}

export function sigmetMapAreas(reports, reference, now = Date.now()) {
  return reports.flatMap(report => {
    const from = Number(report?.validTimeFrom) * 1000
    const to = Number(report?.validTimeTo) * 1000
    if (report?.validTimeFrom == null || !(from <= now && to > now) || Math.abs(from) > 8.64e15 || Math.abs(to) > 8.64e15) return []
    const rings = report.geom === "AREAS" ? report.coords : report.geom === "AREA" ? [report.coords] : []
    const polygons = (Array.isArray(rings) ? rings : []).map(ring => polygonAround(ring, reference)).filter(ring => ring.length)
    if (!polygons.length) return []
    return [{
      title: [report.firId, "SIGMET", report.seriesId, report.hazard].filter(Boolean).join(" "),
      times: `${utcText(from)} – ${utcText(to)}`,
      altitude: `${level(report.base)} – ${level(report.top)}`,
      report: report.rawSigmet,
      polygons,
    }]
  })
}

export function airportWxPosition(airport, metar, taf, reference) {
  const lat = metar?.lat ?? taf?.lat ?? airport.position?.[0]
  const lon = metar?.lon ?? taf?.lon ?? airport.position?.[1]
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 360
    ? [lat, longitudeNear(lon, reference)] : null
}
