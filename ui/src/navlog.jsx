import { useEffect, useId, useMemo, useState } from "react"
import { Fuel, Search } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  alternateNavlogLegs, dispatchFuelUnit, field, fuelCheckDue, fuelStatus, navlogLegs, navlogMapRoutes,
  parseFuel, plannedEto, takeoffTime, validUtcTime,
} from "./dispatch"
import { NavlogMap } from "./navlog-map"
import { PageBanner } from "./page-banner"

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const formatNumber = value => value == null ? "—" : number.format(value)
const formatTrack = value => value == null ? "—" : `${String(Math.round(value)).padStart(3, "0")}°`
const milestones = new Map([["TOC", "Top of climb"], ["TOD", "Top of descent"]])

function formatElapsed(seconds) {
  if (seconds == null || seconds < 0) return "—"
  const minutes = Math.floor(seconds / 60)
  return [Math.floor(minutes / 60), minutes % 60].map(value => String(value).padStart(2, "0")).join(":")
}

const formatDeviation = value => value == null ? "—" : `${value > 0 ? "+" : ""}${number.format(value)}`
const rowId = (route, index) => `navlog-${route}-${index}`
// Re-renders each minute so the fuel-check reminder appears without user input
function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 60000)
    return () => clearInterval(timer)
  }, [])
  return now
}

const parseTime = value => validUtcTime(value.trim()) ? value.trim() : null

// Saves on blur; an invalid value stays in the field with an error and is not saved
function EntryInput({ label, value, placeholder, parse, inputMode = "numeric", error: errorText, onCommit, className }) {
  const errorId = useId()
  const [draft, setDraft] = useState(value ?? "")
  const [error, setError] = useState(false)
  useEffect(() => { setDraft(value ?? ""); setError(false) }, [value])
  function commit() {
    const parsed = parse ? parse(draft) : draft.trim()
    setError(parsed === null)
    if (parsed !== null && String(parsed) !== (value ?? "")) onCommit(parsed === "" ? undefined : parsed)
  }
  return <>
    <Input aria-label={label} value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()}
      inputMode={parse ? inputMode : undefined} autoComplete="off" aria-invalid={error || undefined} aria-describedby={error ? errorId : undefined}
      className={`h-8 font-mono text-sm ${className}`} />
    {error && <span id={errorId} className="mt-1 block font-sans text-xs whitespace-normal text-destructive">{errorText}</span>}
  </>
}

function RouteTable({ title, route, legs, units, flight, entries, updateEntry, query }) {
  const takeoff = takeoffTime(flight)
  const now = useNow()
  const dueIndex = route === "p" ? fuelCheckDue(legs, entries, takeoff, now) : -1
  const fuelUnit = units ? ` (${units})` : ""
  const headings = ["Airway", "Altitude (ft)", "Mag track", "Leg (NM)", "Total (NM)", "Elapsed (hh:mm)", `Fuel left${fuelUnit}`]
  const search = query.trim().toLowerCase()
  const rows = legs.map((leg, index) => ({ leg, index, key: `${route}:${index}` })).filter(({ leg, key }) => !search ||
    [leg.ident, leg.airway, entries[key]?.note].some(text => String(text ?? "").toLowerCase().includes(search)))
  if (search && !rows.length) return null
  return <div className="panel min-w-0 overflow-hidden">
    <div role="region" aria-label={title} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <table className="w-full min-w-[68rem] text-sm">
        <caption className="caption-top border-b bg-toolbar px-4 py-3 text-left font-semibold">{title}</caption>
        <TableHeader>
          <TableRow className="bg-muted hover:bg-muted">
            <TableHead scope="col" className="sticky left-0 z-10 border-r bg-muted px-4">Waypoint</TableHead>
            {headings.map((heading, index) => <TableHead key={heading} scope="col" className={index > 0 ? "text-right" : undefined}>{heading}</TableHead>)}
            <TableHead scope="col">ETO (UTC)</TableHead>
            <TableHead scope="col">ATO (UTC)</TableHead>
            <TableHead scope="col">{`Actual fuel${fuelUnit}`}</TableHead>
            <TableHead scope="col" className="pr-4">Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="font-mono tabular-nums">
          {rows.map(({ leg, index, key }) => {
            const milestone = milestones.get(leg.ident)
            const entry = entries[key] ?? {}
            const name = `${leg.ident} (${title})`
            return <TableRow key={key} id={rowId(route, index)} className={milestone ? "bg-accent hover:bg-accent" : "group/navlog-row"}>
              <TableHead scope="row" className={`sticky left-0 max-w-36 border-r px-4 py-2.5 font-semibold whitespace-normal break-words ${milestone ? "bg-accent text-accent-foreground" : "bg-card group-hover/navlog-row:bg-muted"}`}>
                {leg.ident}
                {milestone && <span className="mt-0.5 block font-sans text-xs font-medium whitespace-nowrap">{milestone}</span>}
                {index === dueIndex && <Badge className="mt-1 font-sans"><Fuel />Fuel check due</Badge>}
              </TableHead>
              <TableCell>{leg.airway || "—"}</TableCell>
              <TableCell className="text-right">{formatNumber(leg.altitude)}</TableCell>
              <TableCell className="text-right">{formatTrack(leg.track)}</TableCell>
              <TableCell className="text-right">{formatNumber(leg.distance)}</TableCell>
              <TableCell className="text-right">{formatNumber(leg.totalDistance)}</TableCell>
              <TableCell className="text-right">{formatElapsed(leg.elapsed)}</TableCell>
              <TableCell className="text-right">{formatNumber(leg.fuel)}</TableCell>
              <TableCell className="w-24 align-top"><EntryInput label={`ETO at ${name}`} value={entry.eto} placeholder={plannedEto(takeoff, leg.elapsed) || "HHMM"}
                parse={parseTime} error="Use UTC HHMM, 0000–2359." onCommit={eto => updateEntry(key, { eto })} /></TableCell>
              <TableCell className="w-24 align-top"><EntryInput label={`ATO at ${name}`} value={entry.ato} placeholder="HHMM"
                parse={parseTime} error="Use UTC HHMM, 0000–2359." onCommit={ato => updateEntry(key, { ato })} /></TableCell>
              <TableCell className="w-28 align-top"><EntryInput label={`Actual fuel at ${name}`} value={entry.fuel == null ? "" : String(entry.fuel)}
                parse={value => parseFuel(value, flight)} inputMode="decimal" error={`Enter a fuel figure${fuelUnit} from 0 up to 1.5 × block fuel.`}
                onCommit={fuel => updateEntry(key, { fuel, checkedAt: fuel == null ? undefined : Date.now() })} /></TableCell>
              <TableCell className="w-48 pr-4 align-top"><EntryInput label={`Note at ${name}`} value={entry.note}
                onCommit={note => updateEntry(key, { note })} className="font-sans" /></TableCell>
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

export function Navlog({ flight, airports, openAipAvailable, entries = {}, updateEntry }) {
  const departure = field(flight.origin, "icao_code")
  const destination = field(flight.destination, "icao_code")
  const units = dispatchFuelUnit(flight)
  const { primary, alternates, mapRoutes } = useNavlogRoutes(flight)
  const hasWaypoints = primary.length > 0 || alternates.length > 0
  const [query, setQuery] = useState("")
  const searchId = useId()
  const tableProps = { units, flight, entries, updateEntry, query }

  return <>
    {hasWaypoints && <>
      <NavlogMap routes={mapRoutes} flight={flight} airports={airports} openAipAvailable={openAipAvailable} />
      <div className="flex max-w-sm flex-col gap-2">
        <Label htmlFor={searchId}>Search waypoints</Label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input id={searchId} type="search" className="pl-9" placeholder="Waypoint, airway or note" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
      </div>
      <p className="secondary-copy">Times are UTC (HHMM). Entries save when you leave a field and stay with this dispatch.</p>
      <p className="secondary-copy md:hidden">Scroll the table sideways for more columns.</p>
    </>}
    {primary.length ? <RouteTable title={`Primary route · ${departure} → ${destination}`} route="p" legs={primary} {...tableProps} /> :
      <p className="panel secondary-copy p-5">SimBrief supplied no waypoint data for the primary route.</p>}
    {alternates.map((legs, index) => {
      const airport = airports.find(({ code, role }) => role === "Alternate" && code === legs.at(-1).ident)
      const label = alternates.length > 1 ? `Alternate route ${index + 1}` : "Alternate route"
      return <RouteTable key={index} title={airport ? `${label} · ${destination} → ${airport.code}` : label} route={`a${index}`} legs={legs} {...tableProps} />
    })}
  </>
}

export function FuelMonitoring({ flight, entries, openEntry }) {
  const { primary } = useNavlogRoutes(flight)
  const units = dispatchFuelUnit(flight)
  const status = useMemo(() => fuelStatus(primary, entries), [primary, entries])
  const due = fuelCheckDue(primary, entries, takeoffTime(flight), useNow())
  const unit = value => value == null ? "—" : `${number.format(value)}${units ? ` ${units}` : ""}`
  const { latest } = status
  if (!primary.length) return <div className="space-y-4">
    <PageBanner icon={Fuel} title="Fuel Monitoring" />
    <p className="panel secondary-copy p-5">SimBrief supplied no waypoint data for the primary route.</p>
  </div>

  return <div className="space-y-4">
    <PageBanner icon={Fuel} title="Fuel Monitoring" detail={units ? `Fuel in ${units}` : undefined} />
    {due >= 0 && <Alert>
      <Fuel />
      <AlertTitle>Fuel check due at {primary[due].ident}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>The planned time for {primary[due].ident} has passed with no fuel entry.</span>
        <Button variant="outline" size="sm" onClick={() => openEntry(rowId("p", due))}>Enter in Navlog</Button>
      </AlertDescription>
    </Alert>}
    <dl className="panel grid gap-px overflow-hidden bg-border sm:grid-cols-3">
      <div className="bg-card px-4 py-3">
        <dt className="text-xs font-medium text-muted-foreground">Latest fuel check</dt>
        <dd className="mt-1 font-mono text-sm font-semibold">{latest ? <>
          {latest.leg.ident}{latest.entry.ato && ` · ${latest.entry.ato}Z`} · {unit(latest.actual)}
          <span className="block font-sans text-xs font-normal text-muted-foreground">Deviation {formatDeviation(latest.deviation)}{units ? ` ${units}` : ""}</span>
        </> : <span className="font-sans font-normal text-muted-foreground">No actual fuel entered yet</span>}</dd>
      </div>
      <div className="bg-card px-4 py-3">
        <dt className="text-xs font-medium text-muted-foreground">Estimated fuel at destination</dt>
        <dd className="mt-1 font-mono text-sm font-semibold text-data-accent">{status.destinationEstimate == null ?
          <span className="font-sans font-normal text-muted-foreground">Shown after the first fuel check</span> : unit(status.destinationEstimate)}</dd>
      </div>
      <div className="bg-card px-4 py-3">
        <dt className="text-xs font-medium text-muted-foreground">Planned fuel at destination</dt>
        <dd className="mt-1 font-mono text-sm font-semibold">{unit(status.destinationPlanned)}</dd>
      </div>
    </dl>
    <div className="panel min-w-0 overflow-hidden">
      <div role="region" aria-label="Planned and actual fuel" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <table className="w-full min-w-[36rem] text-sm">
          <caption className="caption-top border-b bg-toolbar px-4 py-3 text-left font-semibold">Planned and actual fuel · primary route</caption>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead scope="col" className="px-4">Waypoint</TableHead>
              <TableHead scope="col">ATO (UTC)</TableHead>
              {["Planned", "Actual", "Deviation"].map(heading => <TableHead key={heading} scope="col" className="text-right">{`${heading}${units ? ` (${units})` : ""}`}</TableHead>)}
              <TableHead scope="col" className="pr-4"><span className="sr-only">Navlog entry</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono tabular-nums">
            {status.rows.map(({ index, leg, entry, planned, actual, deviation }) => <TableRow key={index}>
              <TableHead scope="row" className="px-4 font-semibold">{leg.ident}</TableHead>
              <TableCell>{entry.ato ? `${entry.ato}Z` : "—"}</TableCell>
              <TableCell className="text-right">{formatNumber(planned)}</TableCell>
              <TableCell className="text-right">{formatNumber(actual)}</TableCell>
              <TableCell className={`text-right ${deviation < 0 ? "text-destructive" : ""}`}>{formatDeviation(deviation)}</TableCell>
              <TableCell className="pr-4 text-right font-sans">
                <Button variant="link" size="sm" className="h-auto p-0" onClick={() => openEntry(rowId("p", index))}
                  aria-label={`Open ${leg.ident} in the Navlog`}>{index === due ? "Fuel check due" : "Navlog"}</Button>
              </TableCell>
            </TableRow>)}
          </TableBody>
        </table>
      </div>
    </div>
  </div>
}
