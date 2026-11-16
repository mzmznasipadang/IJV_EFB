import {
  BookOpen, Calculator, CalendarDays, ChartColumnIncreasing, ChartNoAxesCombined, ClipboardCheck,
  Clock, CloudSun, Compass, Database, Droplet, FileText, Fuel, Gauge, LifeBuoy, Map,
  NotebookPen, Plane, Shield, TriangleAlert, UserCircle, Users, Wind,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { field, flightAircraft, flightNumber, flightProgress, navlogLegs } from "./dispatch"

const clock = epoch => epoch ? `${new Date(epoch * 1000).toISOString().slice(11, 16).replace(":", "")}Z` : "—"
const phaseStyles = { Scheduled: "bg-muted text-muted-foreground", "Taxi out": "bg-accent text-accent-foreground", "En route": "bg-primary text-primary-foreground", Arrived: "bg-accent text-accent-foreground" }

function FlightProgress({ flight, entries }) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 60000)
    return () => clearInterval(timer)
  }, [])
  const legs = useMemo(() => navlogLegs(flight.navlog, field(flight.origin, "icao_code")), [flight])
  const progress = flightProgress(flight, legs, entries, now)
  const percent = Math.round(progress.fraction * 100)
  const origin = field(flight.origin, "icao_code")
  const destination = field(flight.destination, "icao_code")
  return <div className="w-full border-t pt-3 mt-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className={`rounded-sm px-2 py-0.5 font-semibold ${phaseStyles[progress.phase]}`}>{progress.phase}</span>
      <span className="font-mono text-muted-foreground">
        {progress.totalNm != null && `${progress.flownNm} / ${Math.round(progress.totalNm)} NM · `}{percent}%
        {progress.basis && <span className="font-sans"> · from {progress.basis}</span>}
      </span>
    </div>
    <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-3">
      <span className="font-mono text-sm font-semibold">{origin}</span>
      <div role="progressbar" aria-label={`Flight progress ${origin} to ${destination}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
        aria-valuetext={`${progress.phase}, ${percent}%`} className="relative h-2 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        <Plane aria-hidden="true" className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 fill-primary text-primary" style={{ left: `${percent}%` }} />
      </div>
      <span className="font-mono text-sm font-semibold">{destination}</span>
    </div>
    <dl className="mt-2 flex justify-between gap-4 font-mono text-xs">
      <div><dt className="sr-only">Departure</dt><dd><span className="font-sans text-muted-foreground">{entries.dep?.out ? "Off-block" : "ETD"} </span>{clock(progress.etd)}</dd></div>
      <div className="text-right"><dt className="sr-only">Arrival</dt><dd><span className="font-sans text-muted-foreground">ETA </span>{clock(progress.eta)}</dd></div>
    </dl>
  </div>
}

function LauncherGroup({ title, items }) {
  return <section className="launcher-group panel">
    <h2>{title}</h2>
    <div className="launcher-grid">
      {items.map(({ label, Icon, open, href, disabledReason }) => {
        const content = <><Icon aria-hidden="true" /><span>{label}</span></>
        return href ? <Button key={label} asChild variant="outline" className="launcher-tile">
          <a href={href} target="_blank" rel="noopener noreferrer">{content}</a>
        </Button> : <Button key={label} variant="outline" className="launcher-tile"
          disabled={!open || Boolean(disabledReason)} title={disabledReason || (!open ? "Unavailable in IJV EFB" : undefined)}
          onClick={open}>{content}</Button>
      })}
    </div>
  </section>
}

export function Home({ flight, entries = {}, navigate, openFlightView, openProfile }) {
  const origin = field(flight?.origin, "icao_code")
  const destination = field(flight?.destination, "icao_code")
  const aircraft = flightAircraft(flight)
  const isAirbus = /^A[23][0-9]|^BCS[13]/i.test(aircraft || "")
  const isBoeing = /^B[0-9]/i.test(aircraft || "") && !isAirbus
  const requiresFlight = flight ? undefined : "Import a dispatch first"
  const openPerformance = () => navigate("performance")

  return <div className="home">
    <h1 className="home-wordmark">
      <span className="sr-only">IJV EFB</span>
      <span aria-hidden="true" className="home-logo" style={{ "--wordmark-image": "url('/image_0.png')" }} />
    </h1>
    <section className="flight-status panel" aria-label="Current flight status">
      <div className="flex min-w-0 items-center gap-4">
        <div className="status-icon"><Plane aria-hidden="true" /></div>
        <div className="min-w-0">
          <p className="status-label">Current status</p>
          <h2>{flight ? `${flightNumber(flight) || "Active flight"} · ${origin} → ${destination}` : "No flight loaded"}</h2>
          {aircraft && <p className="secondary-copy">{[aircraft, field(flight?.aircraft, "reg")].filter(Boolean).join(" · ")}</p>}
        </div>
      </div>
      <Button variant="link" className="status-action" onClick={() => navigate("flight")}>
        {flight ? "Open flight" : "Import dispatch"}
      </Button>
      {flight && <FlightProgress flight={flight} entries={entries} />}
    </section>
    <LauncherGroup title="Flight Briefing" items={[
      { label: "OFP", Icon: FileText, open: () => openFlightView("ofp"), disabledReason: requiresFlight },
      { label: "Navlog", Icon: Map, open: () => navigate("navlog"), disabledReason: requiresFlight },
      { label: "Wind Matrix", Icon: Wind, open: () => navigate("winds"), disabledReason: requiresFlight },
      { label: "Diversion", Icon: LifeBuoy, open: () => navigate("diversion"), disabledReason: requiresFlight },
      { label: "Fuel Monitoring", Icon: Fuel, open: () => navigate("fuel"), disabledReason: requiresFlight },
      { label: "NOTAMs", Icon: TriangleAlert, open: () => navigate("notams"), disabledReason: requiresFlight },
      { label: "Weather", Icon: CloudSun, open: () => navigate("weather") },
    ]} />
    <LauncherGroup title="Performance & Operations" items={[
      { label: "Fuel Req", Icon: Droplet },
      { label: flight && !isAirbus && !isBoeing ? "Performance" : "Airbus Perf", Icon: Calculator,
        open: openPerformance, disabledReason: requiresFlight || (isBoeing ? "This dispatch uses a Boeing aircraft" : undefined) },
      { label: "Boeing Perf", Icon: Calculator, open: openPerformance,
        disabledReason: requiresFlight || (!isBoeing ? "This dispatch does not use a Boeing aircraft" : undefined) },
      { label: "OptiClimb", Icon: ChartNoAxesCombined },
      { label: "NOTOC", Icon: ClipboardCheck },
      { label: "Manifest", Icon: Users, open: () => navigate("manifest"), disabledReason: requiresFlight },
      { label: "Delay Codes", Icon: Clock },
      { label: "Checklists", Icon: ClipboardCheck, open: () => navigate("checklists") },
      { label: "Notes", Icon: NotebookPen, open: () => navigate("notes") },
      { label: "Air Safety Report", Icon: Shield },
    ]} />
    <LauncherGroup title="Systems & Charts" items={[
      { label: "Roster", Icon: CalendarDays },
      { label: "Statistics", Icon: ChartColumnIncreasing },
      { label: "Logbook", Icon: BookOpen },
      { label: "Map", Icon: Map, open: () => navigate("map") },
      { label: "vAMSYS", Icon: Database, href: "https://vamsys.io/phoenix/flight-center/booking" },
      { label: "Navigraph", Icon: Compass, href: "https://charts.navigraph.com" },
      { label: "Taxi Overspeed", Icon: Gauge },
      { label: "Profile", Icon: UserCircle, open: openProfile },
    ]} />
    <footer className="home-footer">
      <p><TriangleAlert aria-hidden="true" />For flight simulation use only. Not for real-world navigation or flight operations.</p>
      <small>© {new Date().getUTCFullYear()} Indonesia Journey Virtual</small>
    </footer>
  </div>
}
