import { useEffect, useLayoutEffect, useState } from "react"
import { ChevronDown, ChevronLeft, ClipboardList, CloudSun, House, LogOut, Map, Monitor, Moon, Sun, UserCircle, Wifi, WifiOff } from "lucide-react"
import { createRoot } from "react-dom/client"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Charts, Checklists } from "./documents"
import { field, flightAircraft, flightAirports, flightNumber, loadDispatch, saveDispatch } from "./dispatch"
import { FlightFolder } from "./flight"
import { Home } from "./home"
import { generateManifest } from "./manifest"
import { Manifest, Notams, Notes, Performance, WindMatrix } from "./tools"
import { Weather } from "./weather"
import "@fontsource-variable/inter/wght.css"
import "./index.css"

const config = JSON.parse(document.getElementById("efb-config").textContent)
const dispatchKey = `ijv-efb-dispatch:${config.pilotCallsign}`
const appearanceOptions = [
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
  ["system", "System", Monitor],
]
const dock = [
  ["home", "Home", House],
  ["flight", "Flight", ClipboardList],
  ["weather", "Weather", CloudSun],
  ["charts", "Charts", Map],
]

function Dock({ active, navigate }) {
  return <nav className="module-dock" aria-label="EFB navigation">
    {dock.map(([id, label, Icon]) => <Button key={id} variant="ghost" className="dock-button"
      aria-current={active === id ? "page" : undefined} onClick={() => navigate(id)}>
      <Icon aria-hidden="true" />{label}
    </Button>)}
  </nav>
}

function Clock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <time className="shrink-0 font-mono text-xs font-semibold tabular-nums sm:text-sm" aria-label="UTC clock">
    {time.toISOString().slice(11, 16)}Z
  </time>
}

function ConnectionStatus() {
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  const Icon = online ? Wifi : WifiOff
  const label = online ? "Browser online" : "Browser offline"
  return <span className="home-connection" data-online={online} role="status" aria-label={label} title={label}><Icon aria-hidden="true" /></span>
}

function useAppearance() {
  const [appearance, setAppearance] = useState(() => document.documentElement.dataset.appearance || "system")
  useLayoutEffect(() => {
    const device = matchMedia("(prefers-color-scheme: dark)")
    const sync = () => {
      const dark = appearance === "dark" || (appearance === "system" && device.matches)
      document.documentElement.classList.toggle("dark", dark)
      document.documentElement.dataset.appearance = appearance
      document.querySelector('meta[name="theme-color"]').content = dark ? "#111824" : "#eef0f4"
    }
    sync()
    if (appearance !== "system") return
    device.addEventListener("change", sync)
    return () => device.removeEventListener("change", sync)
  }, [appearance])

  function chooseAppearance(value) {
    setAppearance(value)
    try {
      localStorage.setItem("ijv-efb-appearance", value)
    } catch {}
  }
  return [appearance, chooseAppearance]
}

function Toolbar({ active, flight, goBack, accountOpen, setAccountOpen }) {
  const [appearance, chooseAppearance] = useAppearance()
  const origin = field(flight?.origin, "icao_code")
  const destination = field(flight?.destination, "icao_code")
  return <header className={active === "home" ? "app-toolbar home-toolbar" : "app-toolbar"}>
    <div className="flex min-w-0 items-center gap-2">
      {active !== "home" && <Button className="toolbar-button" variant="outline" size="icon" onClick={goBack} aria-label="Back"><ChevronLeft /></Button>}
      <div className="clock-tile"><Clock /></div>
      {flight && active !== "home" && <span className="toolbar-flight">
        {flightNumber(flight) && <strong>{flightNumber(flight)}</strong>} <span className="font-mono">{origin} → {destination}</span>
      </span>}
    </div>
    <div className="toolbar-account">
      {active === "home" && <ConnectionStatus />}
      <DropdownMenu open={accountOpen} onOpenChange={setAccountOpen}>
        <DropdownMenuTrigger asChild>
          <Button className="toolbar-button account-trigger" variant="outline" aria-label="Pilot account">
            <UserCircle />
            {active === "home" ? <>
              <span className="account-name">{config.pilotName.replace(/^Capt\.\s+/i, "")}</span>
              <span className="account-callsign">{config.pilotCallsign}</span>
            </> : <span>{config.pilotCallsign}</span>}
            <ChevronDown className="account-chevron" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{config.pilotName}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={appearance} onValueChange={chooseAppearance} aria-label="Appearance">
            {appearanceOptions.map(([value, label, Icon]) => <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />{label}
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild><a href="?logout=1" onClick={() => localStorage.removeItem(dispatchKey)}><LogOut />Sign out</a></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </header>
}

function App() {
  const [pages, setPages] = useState(["home"])
  const active = pages.at(-1)
  const [accountOpen, setAccountOpen] = useState(false)
  const [flight, setFlight] = useState(null)
  const [flightView, setFlightView] = useState("briefing")
  const [weatherAirport, setWeatherAirport] = useState("")
  const [chartAirport, setChartAirport] = useState("")
  const [chartMode, setChartMode] = useState("ijv")
  const [manifest, setManifest] = useState([])
  const airports = flightAirports(flight)

  function navigate(id) {
    setPages(previous => id === "home" ? ["home"] :
      previous.at(-1) === id ? previous : [...previous, id])
    window.scrollTo(0, 0)
  }

  function goBack() {
    setPages(previous => previous.length > 1 ? previous.slice(0, -1) : previous)
    window.scrollTo(0, 0)
  }

  function openFlightView(view) {
    setFlightView(view)
    navigate("flight")
  }

  useEffect(() => {
    const saved = loadDispatch(localStorage, dispatchKey)
    if (saved) activateFlight(saved.flight, saved.manifest)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function activateFlight(dispatch, savedManifest) {
    const plannedAirports = flightAirports(dispatch)
    const departure = plannedAirports[0]?.code || ""
    setFlight(dispatch)
    setWeatherAirport(departure)
    setChartAirport(departure)
    setChartMode("ijv")
    const passengerCount = Number.parseInt(field(dispatch.general, "passengers"), 10)
    const rows = Array.isArray(savedManifest) ? savedManifest :
      generateManifest(config.pilotName, Number.isFinite(passengerCount) ? Math.min(passengerCount, 1000) : 124, field(dispatch.aircraft, "equip_category") || "M")
    setManifest(rows)
    saveDispatch(localStorage, dispatchKey, dispatch, rows)
  }

  function openAirportWeather(code) {
    setWeatherAirport(code)
    navigate("weather")
  }

  function openAirportCharts(code) {
    setChartAirport(code)
    setChartMode("ijv")
    navigate("charts")
  }

  return <>
    <Toolbar active={active} flight={flight} goBack={goBack} accountOpen={accountOpen} setAccountOpen={setAccountOpen} />
    <main className={active === "home" ? "workspace home-workspace" : "workspace"}>
      <div hidden={active !== "home"}><Home flight={flight} navigate={navigate} openFlightView={openFlightView}
        openProfile={() => { window.scrollTo(0, 0); setAccountOpen(true) }} /></div>
      <div hidden={active !== "flight"}><FlightFolder flight={flight} setFlight={activateFlight} airports={airports} simbriefId={config.simbriefId} acars={config.acars}
        openWeather={openAirportWeather} openCharts={openAirportCharts} view={flightView} setView={setFlightView} /></div>
      <div hidden={active !== "weather"}><Weather airport={weatherAirport} setAirport={setWeatherAirport} flightAirports={airports} /></div>
      <div hidden={active !== "charts"}><Charts catalog={config.charts} airport={chartAirport} setAirport={setChartAirport}
        airports={airports} mode={chartMode} setMode={setChartMode} /></div>
      <div hidden={active !== "performance"}><Performance flight={flight} /></div>
      <div hidden={active !== "checklists"}><Checklists catalog={config.checklists} aircraft={flightAircraft(flight)} /></div>
      <div hidden={active !== "notes"}><Notes /></div>
      <div hidden={active !== "notams"}><Notams flight={flight} /></div>
      <div hidden={active !== "winds"}><WindMatrix flight={flight} /></div>
      <div hidden={active !== "manifest"}><Manifest flight={flight} rows={manifest} /></div>
    </main>
    {active !== "home" && <Dock active={active} navigate={navigate} />}
  </>
}

createRoot(document.getElementById("root")).render(<App />)
