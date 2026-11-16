import {
  BookOpen, Calculator, CalendarDays, ChartColumnIncreasing, ChartNoAxesCombined, ClipboardCheck,
  Clock, CloudSun, Compass, Database, Droplet, FileText, Fuel, Gauge, LifeBuoy, Map,
  NotebookPen, Plane, Shield, TriangleAlert, UserCircle, Users, Wind,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { field, flightAircraft, flightNumber } from "./dispatch"

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

export function Home({ flight, navigate, openOFP, openProfile }) {
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
          {aircraft && <p className="secondary-copy">{aircraft}</p>}
        </div>
      </div>
      <Button variant="link" className="status-action" onClick={() => navigate("flight")}>
        {flight ? "Open flight" : "Import dispatch"}
      </Button>
    </section>
    <LauncherGroup title="Flight Briefing" items={[
      { label: "OFP", Icon: FileText, open: openOFP, disabledReason: requiresFlight },
      { label: "Navlog", Icon: Map },
      { label: "Wind Matrix", Icon: Wind, open: () => navigate("winds"), disabledReason: requiresFlight },
      { label: "Diversion", Icon: LifeBuoy },
      { label: "Fuel Monitoring", Icon: Fuel },
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
      { label: "Charts", Icon: Map, open: () => navigate("charts") },
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
