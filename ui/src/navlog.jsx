import { useMemo } from "react"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { alternateNavlogLegs, field, navlogLegs, navlogMapRoutes } from "./dispatch"
import { NavlogMap } from "./navlog-map"

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const formatNumber = value => value == null ? "—" : number.format(value)
const formatTrack = value => value == null ? "—" : `${String(Math.round(value)).padStart(3, "0")}°`
const milestones = new Map([["TOC", "Top of climb"], ["TOD", "Top of descent"]])

function formatElapsed(seconds) {
  if (seconds == null || seconds < 0) return "—"
  const minutes = Math.floor(seconds / 60)
  return [Math.floor(minutes / 60), minutes % 60].map(value => String(value).padStart(2, "0")).join(":")
}

function RouteTable({ title, legs, units }) {
  const headings = ["Airway", "Altitude (ft)", "Mag track", "Leg (NM)", "Total (NM)", "Elapsed (hh:mm)", units ? `Fuel left (${units})` : "Fuel left"]
  return <div className="panel min-w-0 overflow-hidden">
    <div role="region" aria-label={title} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <table className="w-full min-w-[42rem] text-sm">
        <caption className="caption-top border-b bg-toolbar px-4 py-3 text-left font-semibold">{title}</caption>
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead scope="col" className="sticky left-0 z-10 border-r bg-muted px-4">Waypoint</TableHead>
            {headings.map((heading, index) => <TableHead key={heading} scope="col" className={index > 0 ? "text-right last:pr-4" : undefined}>{heading}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono tabular-nums">
          {legs.map((leg, index) => {
            const milestone = milestones.get(leg.ident)
            return <TableRow key={index} className={milestone ? "bg-accent hover:bg-accent" : "group/navlog-row"}>
              <TableHead scope="row" className={`sticky left-0 max-w-36 border-r px-4 py-2.5 font-semibold whitespace-normal break-words ${milestone ? "bg-accent text-accent-foreground" : "bg-card group-hover/navlog-row:bg-muted"}`}>
                {leg.ident}
                {milestone && <span className="mt-0.5 block font-sans text-xs font-medium whitespace-nowrap">{milestone}</span>}
              </TableHead>
              <TableCell>{leg.airway || "—"}</TableCell>
              <TableCell className="text-right">{formatNumber(leg.altitude)}</TableCell>
              <TableCell className="text-right">{formatTrack(leg.track)}</TableCell>
              <TableCell className="text-right">{formatNumber(leg.distance)}</TableCell>
              <TableCell className="text-right">{formatNumber(leg.totalDistance)}</TableCell>
              <TableCell className="text-right">{formatElapsed(leg.elapsed)}</TableCell>
              <TableCell className="pr-4 text-right">{formatNumber(leg.fuel)}</TableCell>
            </TableRow>
          })}
        </TableBody>
      </table>
    </div>
  </div>
}

function useNavlogRoutes(flight) {
  return useMemo(() => {
    const departure = field(flight?.origin, "icao_code")
    const destination = field(flight?.destination, "icao_code")
    const primary = navlogLegs(flight?.navlog, departure)
    const alternates = alternateNavlogLegs(flight?.alternate_navlog, destination)
    return { primary, alternates, mapRoutes: navlogMapRoutes(primary, alternates) }
  }, [flight])
}

export function FlightMap({ flight, airports, openAipAvailable }) {
  const { mapRoutes } = useNavlogRoutes(flight)
  return <NavlogMap routes={mapRoutes} flight={flight} airports={airports} openAipAvailable={openAipAvailable} standalone />
}

export function Navlog({ flight, airports, openAipAvailable }) {
  const departure = field(flight.origin, "icao_code")
  const destination = field(flight.destination, "icao_code")
  const rawUnits = String(field(flight.params, "units") ?? "").toLowerCase()
  const units = /^kgs?$/.test(rawUnits) ? "kg" : /^lbs?$/.test(rawUnits) ? "lb" : null
  const { primary, alternates, mapRoutes } = useNavlogRoutes(flight)
  const hasWaypoints = primary.length > 0 || alternates.length > 0

  return <>
    {hasWaypoints && <>
      <NavlogMap routes={mapRoutes} flight={flight} airports={airports} openAipAvailable={openAipAvailable} />
      <p className="secondary-copy md:hidden">Scroll the table sideways for more columns.</p>
    </>}
    {primary.length ? <RouteTable title={`Primary route · ${departure} → ${destination}`} legs={primary} units={units} /> :
      <p className="panel secondary-copy p-5">SimBrief supplied no waypoint data for the primary route.</p>}
    {alternates.map((legs, index) => {
      const airport = airports.find(({ code, role }) => role === "Alternate" && code === legs.at(-1).ident)
      const label = alternates.length > 1 ? `Alternate route ${index + 1}` : "Alternate route"
      return <RouteTable key={index} title={airport ? `${label} · ${destination} → ${airport.code}` : label} legs={legs} units={units} />
    })}
  </>
}
