import { Fragment, useEffect, useId, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, Fuel, Map as MapIcon, Printer, Search, StickyNote } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  actualTakeoffFuel, alternateNavlogLegs, dispatchFuelUnit, field, flightNumber, fuelCheckDue, fuelStatus, navlogLegs,
  navlogMapRoutes, parseFuel, revisedEtos, takeoffTime, validUtcTime,
} from "./dispatch"
import { NavlogMap } from "./navlog-map"
import { PageBanner } from "./page-banner"

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const formatNumber = value => value == null ? "—" : number.format(value)
const formatDeviation = value => value == null ? "—" : `${value > 0 ? "+" : ""}${number.format(value)}`
const rowId = (route, index) => `navlog-${route}-${index}`
const parseTime = value => validUtcTime(value.trim()) ? value.trim() : null
const reminderKey = "ijv-efb-fuel-reminder"
export const fuelRemindersOn = () => { try { return localStorage.getItem(reminderKey) !== "off" } catch { return true } }

// OFP navlog formatting, matching ops/ijv-efb-dispatch/ofp_render.py
const num = (fix, key) => { const value = Number(field(fix, key)); return field(fix, key) == null || field(fix, key) === "" || !Number.isFinite(value) ? null : value }
const pad = (value, width) => value == null ? "—" : String(Math.round(value)).padStart(width, "0")
const clock = epoch => epoch == null ? "" : new Date(epoch * 1000).toISOString().slice(11, 16).replace(":", "")
const duration = seconds => seconds == null ? "—" : `${pad(Math.floor(seconds / 3600), 2)}${pad(Math.floor(seconds / 60) % 60, 2)}`
function coordinate(value, isLat) {
  if (value == null) return ""
  const degrees = Math.floor(Math.abs(value))
  return `${isLat ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W")}${String(degrees).padStart(isLat ? 2 : 3, "0")}${((Math.abs(value) - degrees) * 60).toFixed(1).padStart(4, "0")}`
}
const position = fix => num(fix, "pos_lat") == null || num(fix, "pos_long") == null ? "—" : `${coordinate(num(fix, "pos_lat"), true)}${coordinate(num(fix, "pos_long"), false)}`
const isa = fix => num(fix, "oat_isa_dev") == null ? "ISA" : `ISA${num(fix, "oat_isa_dev") >= 0 ? "+" : "-"}${pad(Math.abs(num(fix, "oat_isa_dev")), 2)}`
const flightLevel = fix => field(fix, "stage") === "CLB" ? "CLB" : pad(num(fix, "altitude_feet") == null ? null : num(fix, "altitude_feet") / 100, 3)
const wind = fix => num(fix, "wind_dir") == null ? "—" : `${pad(num(fix, "wind_dir"), 3)}${pad(num(fix, "wind_spd"), 3)}`

// Re-renders each minute so the fuel-check reminder appears without user input
function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 60000)
    return () => clearInterval(timer)
  }, [])
  return now
}

// Saves on blur; an invalid value stays in the field with an error and is not saved
export function EntryInput({ id, label, value, placeholder, parse, inputMode = "numeric", error: errorText, onCommit, className = "" }) {
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
    <Input id={id} aria-label={label} value={draft} placeholder={placeholder} onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()}
      inputMode={parse ? inputMode : undefined} autoComplete="off" aria-invalid={error || undefined} aria-describedby={error ? errorId : undefined}
      className={`navlog-entry h-9 px-1.5 font-mono text-base md:h-7 md:text-sm ${className}`} />
    {error && <span id={errorId} role="alert" className="mt-1 block max-w-32 font-sans text-xs whitespace-normal text-destructive">{errorText}</span>}
  </>
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

const timeError = "Use UTC HHMM, 0000–2359."
const headings = [["ETO", "ATO"], ["TIM", "TIM"], ["AWY", "COORD"], ["WPT/FRQ", ""], ["TTK", "MTK"], ["DIS", "TTL"],
  ["TAS", "G/S"], ["FLV", "GMA"], ["TD/TP", "WIND"], ["FBO", "ABO"], ["PFRM", "AFRM"]]

function LogTable({ title, route, legs, flight, entries, updateEntry, query, reminder, now, departure }) {
  const takeoff = takeoffTime(flight)
  const units = dispatchFuelUnit(flight)
  const etos = revisedEtos(legs, entries, takeoff, route)
  const dueIndex = route === "p" && reminder ? fuelCheckDue(legs, entries, etos, now) : -1
  const burnBase = actualTakeoffFuel(flight, entries) ?? num(flight.fuel, "plan_takeoff")
  const fuelError = `Enter fuel${units ? ` in ${units}` : ""} from 0 up to 1.5 × block fuel.`
  const [notesOpen, setNotesOpen] = useState(() => new Set())
  const search = query.trim().toLowerCase()
  // SimBrief may list the departure airport as the first fix; the DEP row already covers it
  const rows = legs.map((leg, index) => ({ leg, index, key: `${route}:${index}` }))
    .filter(({ leg, index }) => !(departure && index === 0 && leg.ident === field(flight.origin, "icao_code")))
    .filter(({ leg, key }) => !search || [leg.ident, leg.airway, entries[key]?.note].some(text => String(text ?? "").toLowerCase().includes(search)))
  if (search && !rows.length) return null
  const toggleNote = key => setNotesOpen(open => { const next = new Set(open); next.has(key) ? next.delete(key) : next.add(key); return next })
  const cell = "px-2 py-1 align-top whitespace-nowrap"

  return <div className="panel min-w-0 overflow-hidden">
    <div role="region" aria-label={title} tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
      <table className="navlog-table w-full min-w-[62rem] text-sm">
        <caption className={route === "p" ? "sr-only" : "caption-top border-b bg-toolbar px-4 py-3 text-left font-semibold"}>{title}</caption>
        <TableHeader>
          {[0, 1].map(line => <TableRow key={line} className="border-0 bg-muted hover:bg-muted">
            {headings.map(([top, bottom], index) => <TableHead key={index} scope="col"
              className={`h-7 px-2 font-mono text-xs font-semibold text-data-accent ${index >= 4 ? "text-right" : ""} ${index === 0 ? "pl-4" : ""}`}>{line ? bottom : top}</TableHead>)}
            {line === 0 && <TableHead scope="col" rowSpan={2} className="px-2 pr-4 text-right font-mono text-xs font-semibold text-data-accent">DIFF</TableHead>}
          </TableRow>)}
        </TableHeader>
        {departure && <TableBody className="border-b-2 font-mono tabular-nums">
          <TableRow className="border-0 hover:bg-transparent">
            <TableCell colSpan={4} className={`${cell} pl-4 font-semibold`}>
              DEP {field(flight.origin, "icao_code")}{field(flight.origin, "plan_rwy") && ` · RWY ${field(flight.origin, "plan_rwy")}`}
              {num(flight.origin, "elevation") != null && ` · ELEV ${pad(num(flight.origin, "elevation"), 4)} FT`}
            </TableCell>
            <TableCell colSpan={3} className={`${cell} text-right`}>
              <span className="mr-2 text-xs text-muted-foreground">DEP</span>
              <EntryInput label="Actual off-block time (UTC)" value={entries.dep?.out} placeholder={clock(num(flight.times, "est_out"))}
                parse={parseTime} error={timeError} className="w-16" onCommit={out => updateEntry("dep", { out })} />
            </TableCell>
            <TableCell colSpan={2} className={`${cell} text-right`}>
              <span className="mr-2 text-xs text-muted-foreground">A/B</span>
              <EntryInput label="Actual airborne time (UTC)" value={entries.dep?.off} placeholder={clock(takeoff)}
                parse={parseTime} error={timeError} className="w-16" onCommit={off => updateEntry("dep", { off })} />
            </TableCell>
            <TableCell className={`${cell} text-right`}>{pad(num(flight.fuel, "taxi"), 5)}</TableCell>
            <TableCell className={`${cell} text-right`}>{pad(num(flight.fuel, "plan_takeoff"), 6)}</TableCell>
            <TableCell className={`${cell} pr-4`} />
          </TableRow>
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={12} className={`${cell} pb-2 pl-4 text-muted-foreground`}>{position(flight.origin)}</TableCell>
          </TableRow>
        </TableBody>}
        {rows.map(({ leg, index, key }) => {
          const fix = leg.fix
          const entry = entries[key] ?? {}
          const name = `${leg.ident} (${title})`
          const noteOpen = notesOpen.has(key) || Boolean(entry.note)
          const diff = typeof entry.fuel === "number" && leg.fuel != null ? entry.fuel - leg.fuel : null
          const milestone = leg.ident === "TOC" || leg.ident === "TOD"
          return <TableBody key={key} id={rowId(route, index)} className={`border-b font-mono tabular-nums ${milestone ? "bg-accent/60" : ""} ${index === dueIndex ? "bg-primary/10" : ""}`}>
            <TableRow className="border-0 hover:bg-transparent">
              <TableCell className={`${cell} pt-2 pl-4`}><EntryInput label={`ETO at ${name}`} value={entry.eto} placeholder={clock(etos[index]) || "HHMM"}
                parse={parseTime} error={timeError} className="w-16" onCommit={eto => updateEntry(key, { eto })} /></TableCell>
              <TableCell className={`${cell} pt-2.5`}>{duration(num(fix, "time_leg"))}</TableCell>
              <TableCell className={`${cell} pt-2.5`}>{leg.airway || "—"}</TableCell>
              <TableCell className={`${cell} pt-1.5`}>
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {leg.ident}{field(fix, "frequency") && <span className="font-normal text-muted-foreground">{field(fix, "frequency")}</span>}
                  <Button type="button" variant="outline" size="icon" className="size-9 md:size-7" aria-expanded={noteOpen} aria-controls={`${rowId(route, index)}-note`}
                    aria-label={`${entry.note ? "Edit" : "Add"} note at ${leg.ident}`} onClick={() => toggleNote(key)}>
                    <StickyNote className={entry.note ? "text-data-accent" : ""} />
                  </Button>
                </span>
                {index === dueIndex && <Badge className="mt-1 block w-fit font-sans"><Fuel />Fuel check due</Badge>}
              </TableCell>
              <TableCell className={`${cell} pt-2.5 text-right`}>{num(fix, "track_true") == null ? "—" : `${pad(num(fix, "track_true"), 3)}T`}</TableCell>
              <TableCell className={`${cell} pt-2.5 text-right`}>{pad(leg.distance, 3)}</TableCell>
              <TableCell className={`${cell} pt-2.5 text-right`}>{pad(num(fix, "true_airspeed"), 3)}</TableCell>
              <TableCell className={`${cell} pt-2.5 text-right`}>{flightLevel(fix)}</TableCell>
              <TableCell className={`${cell} pt-2.5 text-right`}>{isa(fix)}</TableCell>
              <TableCell className={`${cell} pt-2.5 text-right`}>{pad(num(fix, "fuel_totalused"), 5)}</TableCell>
              <TableCell className={`${cell} pt-2.5 text-right`}>{pad(leg.fuel, 6)}</TableCell>
              <TableCell rowSpan={2} className={`${cell} pr-4 text-right align-middle font-semibold ${diff < 0 ? "text-destructive" : ""}`}>{formatDeviation(diff)}</TableCell>
            </TableRow>
            <TableRow className="border-0 hover:bg-transparent">
              <TableCell className={`${cell} pb-2 pl-4`}><EntryInput label={`ATO at ${name}`} value={entry.ato} placeholder="HHMM"
                parse={parseTime} error={timeError} className="w-16" onCommit={ato => updateEntry(key, { ato })} /></TableCell>
              <TableCell className={`${cell} pt-1.5`}>{duration(leg.elapsed)}</TableCell>
              <TableCell colSpan={2} className={`${cell} pt-1.5 text-muted-foreground`}>{position(fix)}</TableCell>
              <TableCell className={`${cell} pt-1.5 text-right`}>{num(fix, "track_mag") == null ? "—" : `${pad(num(fix, "track_mag"), 3)}M`}</TableCell>
              <TableCell className={`${cell} pt-1.5 text-right`}>{pad(leg.totalDistance, 4)}</TableCell>
              <TableCell className={`${cell} pt-1.5 text-right`}>{pad(num(fix, "groundspeed"), 3)}</TableCell>
              <TableCell className={`${cell} pt-1.5 text-right`}>{pad(num(fix, "mora") == null ? null : num(fix, "mora") / 100, 3)}</TableCell>
              <TableCell className={`${cell} pt-1.5 text-right`}>{wind(fix)}</TableCell>
              <TableCell className={`${cell} pt-1.5 text-right`}>{typeof entry.fuel === "number" && burnBase != null ? pad(burnBase - entry.fuel, 5) : "—"}</TableCell>
              <TableCell className={`${cell} pb-2 text-right`}><EntryInput label={`Actual fuel remaining at ${name}`} value={entry.fuel == null ? "" : String(entry.fuel)}
                placeholder="AFRM" parse={value => parseFuel(value, flight)} inputMode="decimal" error={fuelError} className="w-20 text-right"
                onCommit={fuel => updateEntry(key, { fuel, checkedAt: fuel == null ? undefined : Date.now() })} /></TableCell>
            </TableRow>
            {noteOpen && <TableRow className="border-0 hover:bg-transparent">
              <TableCell colSpan={12} className={`${cell} pb-2.5 pl-4`} id={`${rowId(route, index)}-note`}>
                <EntryInput label={`Note at ${name}`} value={entry.note} placeholder="Note" className="w-full max-w-xl font-sans"
                  onCommit={note => updateEntry(key, { note })} />
              </TableCell>
            </TableRow>}
          </TableBody>
        })}
      </table>
    </div>
  </div>
}

export function FlightMap({ flight, airports, openAipAvailable }) {
  const { mapRoutes } = useNavlogRoutes(flight)
  return <NavlogMap routes={mapRoutes} flight={flight} airports={airports} openAipAvailable={openAipAvailable} standalone />
}

export function Navlog({ flight, airports, entries = {}, updateEntry }) {
  const departure = field(flight.origin, "icao_code")
  const destination = field(flight.destination, "icao_code")
  const units = dispatchFuelUnit(flight)
  const { primary, alternates } = useNavlogRoutes(flight)
  const [query, setQuery] = useState("")
  const [reminder, setReminder] = useState(fuelRemindersOn)
  const now = useNow()
  const tableProps = { flight, entries, updateEntry, query, reminder, now }

  function toggleReminder(on) {
    setReminder(on)
    try { localStorage.setItem(reminderKey, on ? "on" : "off") } catch {}
  }

  function jump(direction) {
    const next = primary.findIndex((leg, index) => !entries[`p:${index}`]?.ato && !(index === 0 && leg.ident === departure))
    const target = direction === "top" ? document.getElementById("navlog-log") : document.getElementById(rowId("p", next))
    target?.scrollIntoView({ block: direction === "top" ? "start" : "center" })
    target?.querySelector("input")?.focus({ preventScroll: true })
  }

  return <div id="navlog-log" className="navlog-print space-y-3">
    <header className="page-banner">
      <h1 className="page-title"><MapIcon aria-hidden="true" />Navigation Log</h1>
      <span className="page-detail font-mono">{flightNumber(flight)}</span>
    </header>
    <div className="panel navlog-toolbar flex flex-wrap items-center gap-3 p-3">
      <div className="flex gap-2">
        <Button variant="outline" size="icon" className="touch-control" aria-label="Go to top of the log" onClick={() => jump("top")}><ChevronUp /></Button>
        <Button variant="outline" size="icon" className="touch-control" aria-label="Go to the next waypoint without an ATO" onClick={() => jump("next")}><ChevronDown /></Button>
        <Button variant="outline" className="touch-control" onClick={() => window.print()}><Printer />Print</Button>
      </div>
      <div className="relative min-w-48 grow basis-56 sm:max-w-sm sm:mx-auto">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input type="search" aria-label="Search waypoints" className="pl-9" placeholder="Search waypoint, airway or note…" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      <label className="inline-flex cursor-pointer items-center gap-3 text-xs font-semibold tracking-wide uppercase">
        Fuel-check reminder
        <input type="checkbox" role="switch" className="peer sr-only" checked={reminder} onChange={event => toggleReminder(event.target.checked)} />
        <span aria-hidden="true" className="relative h-6 w-11 shrink-0 rounded-full bg-muted ring-1 ring-border transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
      </label>
    </div>
    <p className="secondary-copy">
      ETO / ATO in UTC as HHMM. ABO / AFRM in {units ? units.toUpperCase() : "the dispatch unit"}. Grey ETO figures are the planned or revised estimates. DIFF = AFRM − PFRM.
      Entries save when you leave a field and stay with this dispatch.
    </p>
    {primary.length ? <LogTable title={`Primary route · ${departure} → ${destination}`} route="p" legs={primary} departure {...tableProps} /> :
      <p className="panel secondary-copy p-5">SimBrief supplied no waypoint data for the primary route.</p>}
    {alternates.map((legs, index) => {
      const airport = airports.find(({ code, role }) => role === "Alternate" && code === legs.at(-1).ident)
      const label = alternates.length > 1 ? `Alternate route ${index + 1}` : "Alternate route"
      return <Fragment key={index}><LogTable title={airport ? `${label} · ${destination} → ${airport.code}` : label} route={`a${index}`} legs={legs} {...tableProps} /></Fragment>
    })}
  </div>
}

export function FuelMonitoring({ flight, entries, openEntry }) {
  const { primary } = useNavlogRoutes(flight)
  const units = dispatchFuelUnit(flight)
  const plannedTakeoff = num(flight.fuel, "plan_takeoff")
  const takeoffActual = actualTakeoffFuel(flight, entries)
  const status = useMemo(() => fuelStatus(primary, entries, { planned: plannedTakeoff, actual: takeoffActual }), [primary, entries, plannedTakeoff, takeoffActual])
  const now = useNow()
  const due = fuelRemindersOn() ? fuelCheckDue(primary, entries, revisedEtos(primary, entries, takeoffTime(flight)), now) : -1
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
          {latest.index < 0 ? "Takeoff (release ramp fuel)" : latest.leg.ident}{latest.entry.ato && ` · ${latest.entry.ato}Z`} · {unit(latest.actual)}
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
