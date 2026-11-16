import { airportWxPosition, notamMapAreas, sigmetMapAreas } from "./navlog-briefing.js"
import { getAirportData, getJSON } from "./weather"

const refreshInterval = 5 * 60 * 1000
const wxColors = new Map([["VFR", "#16753c"], ["MVFR", "#265ba8"], ["IFR", "#a32837"], ["LIFR", "#723c87"]])
const popupOptions = {
  className: "navlog-briefing-popup", maxWidth: 320, maxHeight: 210,
  autoPanPaddingTopLeft: [50, 8], autoPanPaddingBottomRight: [8, 8],
}

function popup(title, sections) {
  const node = document.createElement("div")
  const add = (tag, text, className) => {
    if (!text) return
    const child = document.createElement(tag)
    child.textContent = text
    child.className = className
    node.append(child)
  }
  add("strong", title, "text-sm")
  for (const { label, detail, text } of sections) {
    add("h3", label, "mt-2 font-semibold")
    add("div", detail, "mt-1 text-xs")
    add("pre", text, "mt-1 whitespace-pre-wrap break-words")
  }
  return node
}

function refreshingLayer(leaflet, name, load, draw, onMessage) {
  const layer = leaflet.layerGroup()
  let controller
  let timer
  async function refresh() {
    if (controller) return
    const request = new AbortController()
    controller = request
    if (!layer.getLayers().length) onMessage(name, `Loading ${name}…`)
    try {
      const data = await load(AbortSignal.any([request.signal, AbortSignal.timeout(20000)]))
      if (request.signal.aborted) return
      layer.clearLayers()
      onMessage(name, draw(layer, data))
    } catch {
      if (request.signal.aborted) return
      layer.clearLayers()
      onMessage(name, `${name} could not load.`)
    } finally {
      if (controller === request) controller = null
    }
  }
  return layer.on("add", () => {
    refresh()
    timer = setInterval(refresh, refreshInterval)
  }).on("remove", () => {
    controller?.abort()
    controller = null
    clearInterval(timer)
    layer.clearLayers()
    onMessage(name, "")
  })
}

async function loadAirportWx(airports, signal) {
  return Promise.all(airports.map(async airport => {
    const [observation, forecast] = await Promise.allSettled([
      getAirportData(airport.code, "metar", signal),
      getAirportData(airport.code, "taf", signal),
    ])
    return { airport, metar: observation.value, taf: forecast.value,
      failed: observation.status === "rejected" || forecast.status === "rejected" }
  }))
}

export function createBriefingLayers(leaflet, map, flight, airports, routes, reference, onMessage) {
  map.createPane("navlog-sigmets").style.zIndex = "390"
  map.createPane("navlog-notams").style.zIndex = "395"
  const sigmets = refreshingLayer(leaflet, "SIGMETs", signal => getJSON("/ops/index.php?sigmets=1", signal), (layer, reports) => {
    const areas = sigmetMapAreas(reports, reference)
    for (const area of areas) {
      leaflet.polygon(area.polygons.map(ring => [ring]), {
        pane: "navlog-sigmets", color: "#a62c31", weight: 2, fillOpacity: 0.17,
      }).bindPopup(popup(area.title, [{ detail: `${area.altitude} · ${area.times}`, text: area.report }]), popupOptions).addTo(layer)
    }
    return areas.length ? "" : "The AWC feed has no current SIGMET polygons."
  }, onMessage)

  const waypoints = routes.flatMap(route => route.waypoints)
  const stations = airports.map(airport => ({ ...airport, position: waypoints.find(fix => fix.ident === airport.code)?.position }))
  const airportWx = refreshingLayer(leaflet, "Airport WX", signal => loadAirportWx(stations, signal), (layer, reports) => {
    for (const { airport, metar, taf } of reports) {
      const position = airportWxPosition(airport, metar, taf, reference)
      if (!position || !(metar?.rawOb || taf?.rawTAF)) continue
      const category = metar?.fltCat
      const badge = document.createElement("span")
      badge.className = "block rounded-sm border border-white px-1 text-center text-[10px] leading-4 font-semibold text-white shadow"
      badge.style.backgroundColor = wxColors.get(category) || "#475569"
      badge.textContent = category || "WX"
      leaflet.marker(position, {
        title: `${airport.code} airport weather`, alt: `${airport.code} airport weather`,
        icon: leaflet.divIcon({ html: badge, className: "", iconSize: [34, 18], iconAnchor: [17, 9] }),
      }).bindPopup(popup(`${airport.code} · ${airport.role}`, [
        { label: category ? `METAR · ${category}` : "METAR", text: metar?.rawOb || "No report available." },
        { label: "TAF", text: taf?.rawTAF || "No report available." },
      ]), popupOptions).addTo(layer)
    }
    if (reports.some(report => report.failed)) return "Some airport weather reports could not load."
    return layer.getLayers().length ? "" : "No plottable airport weather reports are available."
  }, onMessage)

  const overlays = { SIGMETs: sigmets }
  if (airports.length) overlays["Airport WX"] = airportWx
  if (flight && notamMapAreas(flight, reference).length) {
    overlays["NOTAM areas"] = refreshingLayer(leaflet, "NOTAM areas", () => notamMapAreas(flight, reference), (layer, areas) => {
      for (const area of areas) {
        const style = { pane: "navlog-notams", color: "#782d83", weight: 2, dashArray: "4 4", fillOpacity: 0.08 }
        const shape = area.radiusNm
          ? leaflet.circle(area.position, { ...style, radius: area.radiusNm * 1852 })
          : leaflet.circleMarker(area.position, { ...style, radius: 5 })
        const title = area.radiusNm ? `NOTAM Q-line · ${area.radiusNm} NM radius` : "NOTAM Q-line point"
        shape.bindPopup(popup(title, area.notices.map(notice => ({
          label: notice.id, detail: notice.times, text: notice.report,
        }))), popupOptions).addTo(layer)
      }
      return areas.length ? "" : "This dispatch has no current plottable NOTAM areas."
    }, onMessage)
  }
  return overlays
}
