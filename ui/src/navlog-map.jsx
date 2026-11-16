import { useEffect, useRef, useState } from "react"
import { Scan } from "lucide-react"
import { Button } from "@/components/ui/button"

const primaryColor = "#15448c"
const alternateColor = "#9a4b0f"
const tileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const attribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
const openAipAttribution = '© <a href="https://www.openaip.net/">OpenAIP</a> (<a href="https://creativecommons.org/licenses/by-nc/4.0/">CC BY-NC 4.0</a>)'

export function NavlogMap({ routes, openAipAvailable }) {
  const container = useRef(null)
  const fitRoute = useRef(null)
  const [status, setStatus] = useState("loading")
  const [aviationUnavailable, setAviationUnavailable] = useState(false)

  useEffect(() => {
    if (!routes.length) return
    const element = container.current
    let map
    let resize
    let disposed = false
    setStatus("loading")
    setAviationUnavailable(false)

    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]).then(([leaflet]) => {
      if (disposed) return
      const animate = !matchMedia("(prefers-reduced-motion: reduce)").matches
      map = leaflet.map(element, { scrollWheelZoom: false, zoomAnimation: animate, fadeAnimation: animate })
      map.attributionControl.setPrefix(false)
      let tilesFailed = false
      leaflet.tileLayer(tileUrl, { attribution, maxZoom: 19, referrerPolicy: "origin" })
        .on("loading", () => { tilesFailed = false })
        .on("tileerror", () => { tilesFailed = true })
        .on("load", () => setStatus(tilesFailed ? "tile-error" : "ready"))
        .addTo(map)
      if (openAipAvailable) {
        let aviationTilesFailed = false
        const aviation = leaflet.tileLayer("/ops/index.php?openaip_tile={z}/{x}/{y}", {
          attribution: openAipAttribution, minZoom: 2, maxZoom: 19, zIndex: 2,
        }).on("loading", () => { aviationTilesFailed = false })
          .on("tileerror", () => { aviationTilesFailed = true })
          .on("load", () => setAviationUnavailable(aviationTilesFailed))
          .on("remove", () => { if (!disposed) setAviationUnavailable(false) })
          .addTo(map)
        leaflet.control.layers({}, { "OpenAIP aviation": aviation }, { collapsed: false, autoZIndex: false }).addTo(map)
      }
      const bounds = leaflet.latLngBounds([])
      for (const route of [...routes].reverse()) {
        const color = route.alternate ? alternateColor : primaryColor
        const dashArray = route.alternate ? "7 6" : undefined
        leaflet.polyline(route.segments, { color: "#fff", weight: 7, dashArray, interactive: false }).addTo(map)
        leaflet.polyline(route.segments, { color, weight: 4, dashArray, interactive: false }).addTo(map)
        for (const { ident, position, endpoint } of route.waypoints) {
          bounds.extend(position)
          const label = document.createElement("span")
          label.textContent = ident
          const milestone = ident === "TOC" || ident === "TOD"
          leaflet.circleMarker(position, {
            color, fillColor: milestone ? color : "#fff", fillOpacity: 1, weight: 2,
            radius: endpoint || milestone ? 6 : 4,
          }).bindTooltip(label, { direction: "top", offset: [0, -5] }).addTo(map)
        }
      }
      fitRoute.current = () => map.fitBounds(bounds, { maxZoom: 10, padding: [28, 28], animate: false })
      let fitted = false
      function updateSize() {
        if (!element.clientWidth || !element.clientHeight) return
        map.invalidateSize({ pan: false, animate: false })
        if (!fitted) {
          fitRoute.current()
          fitted = true
          setStatus("ready")
        }
      }
      resize = new ResizeObserver(updateSize)
      resize.observe(element)
      updateSize()
    }).catch(() => {
      if (disposed) return
      map?.remove()
      map = null
      fitRoute.current = null
      setStatus("unavailable")
    })

    return () => {
      disposed = true
      fitRoute.current = null
      resize?.disconnect()
      map?.remove()
    }
  }, [routes, openAipAvailable])

  const canFit = status === "ready" || status === "tile-error"
  return <section className="panel min-w-0 overflow-hidden" aria-label="Route map">
    <div className="section-bar flex-wrap justify-between">
      <h2 className="section-title">Route map</h2>
      {routes.length > 0 && <Button type="button" variant="outline" size="sm" className="touch-control"
        disabled={!canFit} onClick={() => fitRoute.current?.()}><Scan aria-hidden="true" />Fit route</Button>}
    </div>
    {!routes.length ? <p className="secondary-copy p-4">SimBrief supplied no waypoint coordinates for this dispatch.</p> :
      <>
        <div className="relative isolate">
          <div ref={container} className="h-72 bg-muted! sm:h-[24rem]" aria-label="Interactive planned route map" role="region" />
          {status === "loading" && <p role="status" className="secondary-copy absolute inset-0 grid place-items-center">Loading route map…</p>}
          {status === "unavailable" && <p role="status" className="secondary-copy absolute inset-0 grid place-items-center">The route map could not load.</p>}
        </div>
        {canFit && <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          {routes.some(route => !route.alternate) && <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="grid h-3 w-7 place-items-center rounded-xs bg-white"><span className="w-5 border-t-2" style={{ borderColor: primaryColor }} /></span>
            Primary
          </span>}
          {routes.some(route => route.alternate) && <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="grid h-3 w-7 place-items-center rounded-xs bg-white"><span className="w-5 border-t-2 border-dashed" style={{ borderColor: alternateColor }} /></span>
            Alternate
          </span>}
          {status === "tile-error" && <span role="status">Some basemap tiles could not load.</span>}
          {aviationUnavailable && <span role="status">Some OpenAIP tiles could not load.</span>}
        </div>}
      </>}
  </section>
}
