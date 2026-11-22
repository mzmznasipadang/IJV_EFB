import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { BookOpen, ChevronDown, ChevronLeft, CloudSun, FileText, Fuel, House, LifeBuoy, LogOut, Map, Monitor, Moon, Sun, TriangleAlert, UserCircle, Wifi, WifiOff } from "lucide-react"
import { createRoot } from "react-dom/client"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Charts, Checklists } from "./documents"
import { sendTelex, validCallsign } from "./acars"
import { dispatchId, field, flightAircraft, flightAirports, flightNumber, importDispatch, loadDispatch, loadNavlogEntries, saveDispatch, saveNavlogEntries } from "./dispatch"
import { FlightFolder, ofpViews } from "./flight"
import { Home } from "./home"
import { loadsheetTelex } from "./loadsheet"
import { generateManifest } from "./manifest"
import { Diversion } from "./diversion.jsx"
import { FlightMap, FuelMonitoring, Navlog } from "./navlog"
import { Manifest, Notams, Notes, Performance, WindMatrix } from "./tools"
import { Weather } from "./weather"
import "@fontsource-variable/inter/wght.css"
import "./index.css"

const config = JSON.parse(document.getElementById("efb-config").textContent)
const dispatchKey = `ijv-efb-dispatch:${config.pilotCallsign}`
const navlogKey = `ijv-efb-navlog:${config.pilotCallsign}`
const appearanceOptions = [
  ["light", "Light", Sun],
  ["dark", "Dark", Moon],
  ["system", "System", Monitor],
]
// [page, flight folder view, label, icon, needs a dispatch]
const dock = [
  ["home", null, "Home", House],
  ["flight", "ofp", "OFP", FileText, true],
  ["navlog", null, "Navlog", Map, true],
  ["fuel", null, "Fuel Mon.", Fuel, true],
  ["weather", null, "Weather", CloudSun],
  ["notams", null, "NOTAMs", TriangleAlert, true],
  ["diversion", null, "Diversion", LifeBuoy, true],
  ["charts", null, "Charts", BookOpen],
]

function Dock({ active, flightView, hasFlight, navigate, openFlightView }) {
  const nav = useRef(null)
  // The dock scrolls sideways on phones: keep the current item visible
  useEffect(() => { nav.current?.querySelector("[aria-current]")?.scrollIntoView({ inline: "center", block: "nearest" }) }, [active, flightView])
  return <nav ref={nav} className="module-dock" aria-label="EFB navigation">
    {dock.map(([id, view, label, Icon, needsFlight]) => <Button key={label} variant="ghost" className="dock-button"
      disabled={needsFlight && !hasFlight} title={needsFlight && !hasFlight ? "Import a dispatch first" : undefined}
      aria-current={active === id && (!view || view === flightView || (view === "ofp" && ofpViews.includes(flightView))) ? "page" : undefined}
      onClick={() => view ? openFlightView(view) : navigate(id)}>
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
          <DropdownMenuItem asChild><a href="?logout=1" onClick={() => { localStorage.removeItem(dispatchKey); localStorage.removeItem(navlogKey) }}><LogOut />Sign out</a></DropdownMenuItem>
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
  const [navlogEntries, setNavlogEntries] = useState({})
  const [startup, setStartup] = useState(null)
  const startupAbort = useRef(null)
  const airports = useMemo(() => flightAirports(flight), [flight])

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

  function openNavlogEntry(id) {
    navigate("navlog")
    setTimeout(() => {
      const row = document.getElementById(id)
      row?.scrollIntoView({ block: "center" })
      row?.querySelector("input[aria-label^=\"Actual fuel\"]")?.focus({ preventScroll: true })
    })
  }

  function updateNavlogEntry(key, patch) {
    const next = { ...navlogEntries, [key]: { ...navlogEntries[key], ...patch } }
    setNavlogEntries(next)
    saveNavlogEntries(localStorage, navlogKey, dispatchId(flight), next)
  }

  useEffect(() => {
    const saved = loadDispatch(localStorage, dispatchKey)
    if (saved) activateFlight(saved.flight, saved.manifest)
    if (!config.freshLogin || !config.simbriefId) return

    const controller = new AbortController()
    const { signal } = controller
    let timer
    function abort() {
      clearTimeout(timer)
      controller.abort()
      if (startupAbort.current === abort) startupAbort.current = null
    }
    startupAbort.current = abort
    window.addEventListener("pagehide", abort)

    function finish(text, error = false) {
      if (!signal.aborted) setStartup({ text, error })
      if (startupAbort.current === abort) startupAbort.current = null
    }

    async function reload() {
      setStartup({ text: "Reloading the latest SimBrief flight plan…" })
      let latest
      try {
        latest = await importDispatch(config.simbriefId, AbortSignal.any([signal, AbortSignal.timeout(25000)]))
        signal.throwIfAborted()
      } catch (error) {
        finish(`SimBrief reload failed: ${error.name === "TimeoutError" ? "request timed out" : error.message} Use Import dispatch to try again.`, true)
        return
      }
      activateFlight(latest, dispatchId(latest) === dispatchId(saved?.flight) ? saved?.manifest : undefined)
      if (!config.acars) {
        finish("SimBrief flight plan reloaded.")
        return
      }
      const to = (field(latest.atc, "callsign") || flightNumber(latest)).toUpperCase()
      const id = dispatchId(latest)
      if (!id || !validCallsign(to)) {
        finish("Flight plan reloaded. Automatic loadsheet skipped: no dispatch ID or valid aircraft callsign.", true)
        return
      }
      const sentKey = `ijv-efb-loadsheet:${JSON.stringify([config.pilotCallsign, id, to])}`
      function alreadySent() {
        try { return localStorage.getItem(sentKey) === "1" } catch { return false }
      }
      if (alreadySent()) {
        finish(`Flight plan reloaded. Planned loadsheet already sent to ${to}.`)
        return
      }

      setStartup({ text: `Flight plan reloaded. Planned loadsheet will be sent to ${to} in 30 seconds.`, sending: true })
      timer = setTimeout(async () => {
        async function send() {
          signal.throwIfAborted()
          if (alreadySent()) return finish(`Planned loadsheet already sent to ${to}.`)
          setStartup({ text: `Sending planned loadsheet to ${to}…`, sending: true })
          await sendTelex(to, loadsheetTelex(latest), { signal })
          try { localStorage.setItem(sentKey, "1") } catch {}
          finish(`Hoppie accepted the planned loadsheet for ${to}.`)
        }
        try {
          if (navigator.locks) await navigator.locks.request(sentKey, { signal }, send)
          else await send()
        } catch (error) {
          finish(`Loadsheet send failed: ${error.name === "TimeoutError" ? "request timed out" : error.message} Check ACARS before sending manually.`, true)
        }
      }, 30000)
    }
    reload()
    return () => {
      window.removeEventListener("pagehide", abort)
      abort()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function cancelStartup() {
    if (!startupAbort.current) return
    startupAbort.current()
    setStartup(null)
  }

  function activateFlight(dispatch, savedManifest) {
    const plannedAirports = flightAirports(dispatch)
    const departure = plannedAirports[0]?.code || ""
    setFlight(dispatch)
    setNavlogEntries(loadNavlogEntries(localStorage, navlogKey, dispatchId(dispatch)))
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
      {startup && <p className={`panel mb-3 px-4 py-3 text-sm ${startup.error ? "text-destructive" : "secondary-copy"}`} role="status">{startup.text}</p>}
      <div hidden={active !== "home"}><Home flight={flight} entries={navlogEntries} navigate={navigate} openFlightView={openFlightView}
        openProfile={() => { window.scrollTo(0, 0); setAccountOpen(true) }} /></div>
      <div hidden={active !== "flight"}><FlightFolder flight={flight} setFlight={activateFlight} airports={airports} simbriefId={config.simbriefId} acars={config.acars}
        onManualImport={cancelStartup} autoLoadsheetPending={Boolean(startup?.sending)}
        openWeather={openAirportWeather} openCharts={openAirportCharts} view={flightView} setView={setFlightView} openAipAvailable={config.openAipAvailable}
        navlogEntries={navlogEntries} updateNavlogEntry={updateNavlogEntry} /></div>
      <div hidden={active !== "navlog"}>{flight && <Navlog key={dispatchId(flight)} flight={flight} airports={airports} entries={navlogEntries} updateEntry={updateNavlogEntry} />}</div>
      <div hidden={active !== "weather"}><Weather airport={weatherAirport} setAirport={setWeatherAirport} flightAirports={airports} /></div>
      <div hidden={active !== "charts"}><Charts catalog={config.charts} airport={chartAirport} setAirport={setChartAirport}
        airports={airports} mode={chartMode} setMode={setChartMode} /></div>
      {active === "map" && <div><FlightMap flight={flight} airports={airports} openAipAvailable={config.openAipAvailable} /></div>}
      <div hidden={active !== "performance"}><Performance flight={flight} /></div>
      <div hidden={active !== "checklists"}><Checklists catalog={config.checklists} aircraft={flightAircraft(flight)} /></div>
      <div hidden={active !== "notes"}><Notes /></div>
      <div hidden={active !== "notams"}><Notams flight={flight} /></div>
      <div hidden={active !== "winds"}><WindMatrix flight={flight} /></div>
      <div hidden={active !== "fuel"}>{flight && <FuelMonitoring flight={flight} entries={navlogEntries} openEntry={openNavlogEntry} />}</div>
      {active === "diversion" && flight && <div><Diversion flight={flight} airports={airports} entries={navlogEntries} openAipAvailable={config.openAipAvailable} /></div>}
      <div hidden={active !== "manifest"}><Manifest flight={flight} rows={manifest} /></div>
    </main>
    {active !== "home" && <Dock active={active} flightView={flightView} hasFlight={Boolean(flight)} navigate={navigate} openFlightView={openFlightView} />}
  </>
}

createRoot(document.getElementById("root")).render(<App />)
