import { useEffect, useState } from "react"
import { ArrowDownToLine, ArrowRight, CircleAlert, CloudLightning, Radio, Send, CloudSun, ExternalLink, FileText, FileType, FolderOpen, Map, Plane, UploadCloud } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Navlog } from "./navlog"
import { PageBanner } from "./page-banner"
import { dispatchPdfUrl, field, flightAircraft, flightNumber, importDispatch, newDispatchTelex, notamTelex, ofpTelex, oooiTimes, routeSigmets, sigmetId, sigmetTelex } from "./dispatch"

function utc(value, includeDate = false) {
  if (!value) return "—"
  const date = new Date(Number(value) * 1000)
  if (!Number.isFinite(date.valueOf())) return "—"
  const iso = date.toISOString()
  return (includeDate ? iso.slice(0, 10) + " " : "") + iso.slice(11, 16) + "Z"
}

function ExternalButton({ href, children, variant = "outline" }) {
  return <Button className="touch-control" variant={variant} asChild><a href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink /></a></Button>
}

function ImportForm({ username, setUsername, onImport, busy, error, hasFlight }) {
  return <form className="panel p-5 sm:p-6" onSubmit={onImport}>
    <h2 className="section-title flex items-center gap-2"><UploadCloud className="size-5 text-primary" />Import SimBrief dispatch</h2>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="min-w-0 grow basis-44">
        <Label className="mb-2" htmlFor="dispatch-username">SimBrief username or ID</Label>
        <Input id="dispatch-username" autoComplete="username" className="touch-control bg-muted"
          value={username} onChange={event => setUsername(event.target.value)} required />
      </div>
      <Button className="touch-control" disabled={busy || !username.trim()} type="submit">
        <ArrowDownToLine />{busy ? "Importing…" : hasFlight ? "Update dispatch" : "Import flight"}
      </Button>
    </div>
    {error && <Alert className="mt-4" variant="destructive"><CircleAlert /><AlertTitle>Dispatch unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
  </form>
}

async function sendTelex(to, text) {
  const response = await fetch("/ops/index.php?hoppie=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, text }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Hoppie ACARS is unavailable.")
}

async function weatherTelex(airports) {
  const lines = await Promise.all(airports.map(async ({ code }) => {
    const get = type => fetch(`/ops/index.php?${new URLSearchParams({ proxy_weather: "1", type, icao: code })}`, { signal: AbortSignal.timeout(20000) })
      .then(response => response.json()).then(rows => rows?.[0]).catch(() => null)
    const [metar, taf] = await Promise.all([get("metar"), get("taf")])
    return [metar?.rawOb || `${code} METAR NIL`, taf?.rawTAF || `${code} TAF NIL`].join(" ")
  }))
  return `IJV OPS WX ${lines.join(" ")}`.slice(0, 1500)
}

// shortcut: SIGWX checks only run while this EFB tab is open; move them into the poller if crews need them with the tab closed
const sigwxInterval = 10 * 60 * 1000
const validCallsign = callsign => /^[A-Z0-9]{3,8}$/.test(callsign)

function AcarsPanel({ flight, airports }) {
  const flightKey = field(flight.params, "request_id") || field(flight.params, "time_generated")
  const storageKey = `ijv-efb-sigwx:${flightKey}`
  const [typedCallsign, setTypedCallsign] = useState(() => (field(flight.atc, "callsign") || flightNumber(flight) || "").toUpperCase())
  const [callsign, setCallsign] = useState(typedCallsign) // the callsign telexes go to, settled 1.5 s after typing stops
  useEffect(() => {
    const timer = setTimeout(() => setCallsign(typedCallsign), 1500)
    return () => clearTimeout(timer)
  }, [typedCallsign])
  const [watching, setWatching] = useState(true)
  const [hits, setHits] = useState([])
  const [log, setLog] = useState([])
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState("")

  async function send(label, build) {
    setBusy(label)
    try {
      await sendTelex(callsign, await build())
      setStatus(`${label} sent to ${callsign} · ${new Date().toISOString().slice(11, 16)}Z`)
    } catch (error) {
      setStatus(error.name === "TimeoutError" ? "Request timed out." : error.message)
    } finally {
      setBusy("")
    }
  }

  async function check(resend = false) {
    try {
      const response = await fetch("/ops/index.php?sigmets=1", { signal: AbortSignal.timeout(20000) })
      if (!response.ok) throw new Error("SIGMET feed unavailable.")
      const found = routeSigmets(flight, await response.json())
      setHits(found)
      const sent = new Set(JSON.parse(localStorage.getItem(storageKey) || "[]"))
      const pending = found.filter(sigmet => resend || !sent.has(sigmetId(sigmet)))
      for (const sigmet of pending) {
        await sendTelex(callsign, sigmetTelex(sigmet))
        sent.add(sigmetId(sigmet))
        localStorage.setItem(storageKey, JSON.stringify([...sent]))
      }
      setStatus(`${found.length} SIGMET${found.length === 1 ? "" : "s"} on route, ${pending.length} sent · checked ${new Date().toISOString().slice(11, 16)}Z`)
    } catch (error) {
      setStatus(error.name === "TimeoutError" ? "Request timed out." : error.message)
    }
  }

  useEffect(() => {
    if (!watching || !validCallsign(callsign)) return
    check()
    const timer = setInterval(check, sigwxInterval)
    return () => clearInterval(timer)
  }, [watching, callsign, flight]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the crew once per dispatch that a new OFP was issued
  useEffect(() => {
    const noticeKey = `ijv-efb-dispatch-notice:${flightKey}`
    if (!validCallsign(callsign) || localStorage.getItem(noticeKey)) return
    sendTelex(callsign, newDispatchTelex(flight)).then(() => localStorage.setItem(noticeKey, "1")).catch(() => {})
  }, [callsign, flight, flightKey])

  // ACARS log written by the IJVOPS poller (downlinks) and by uplinks
  useEffect(() => {
    if (!validCallsign(callsign)) return
    const load = () => fetch(`/ops/index.php?${new URLSearchParams({ hoppie: "1", callsign })}`, { signal: AbortSignal.timeout(20000) })
      .then(response => response.ok ? response.json() : []).then(entries => setLog(Array.isArray(entries) ? entries : [])).catch(() => {})
    load()
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [callsign])

  const since = Number(field(flight.params, "time_generated")) || 0
  const flightLog = log.filter(entry => entry.time >= since)
  const oooi = oooiTimes(flightLog)
  const ready = validCallsign(callsign) && callsign === typedCallsign && !busy
  const uplinks = [
    ["Weather", () => weatherTelex(airports)],
    ["OFP summary", () => ofpTelex(flight)],
    ["NOTAM digest", () => notamTelex(flight)],
  ]

  return <section className="panel order-4 min-w-0 overflow-hidden lg:col-span-2" aria-label="Hoppie ACARS">
    <h2 className="section-title section-bar"><Radio className="size-4 text-data-accent" />Hoppie ACARS</h2>
    <div className="flex flex-wrap items-end gap-3 px-4 py-3">
      <div className="min-w-0 basis-40">
        <Label className="mb-2" htmlFor="acars-callsign">ACARS callsign</Label>
        <Input id="acars-callsign" className="touch-control bg-muted font-mono" maxLength={8} value={typedCallsign}
          onChange={event => setTypedCallsign(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
      </div>
      <Button className="touch-control" variant={watching ? "secondary" : "outline"} onClick={() => setWatching(!watching)} aria-pressed={watching}>
        <CloudLightning />{watching ? "SIGWX watch on" : "SIGWX watch paused"}
      </Button>
      <Button className="touch-control" variant="outline" onClick={() => check(true)} disabled={!ready}><Send />Send SIGWX</Button>
      {uplinks.map(([label, build]) => <Button key={label} className="touch-control" variant="outline" onClick={() => send(label, build)} disabled={!ready}>
        <Send />{busy === label ? "Sending…" : label}
      </Button>)}
    </div>
    <p className="secondary-copy px-4 pb-2 text-xs" role="status">{status || "Use the callsign you logged on to Hoppie in the aircraft. SIGWX is checked every 10 minutes while this tab is open. Send \"WX WIII\" to IJVOPS from the aircraft for METAR/TAF."}</p>
    <dl className="grid grid-cols-4 gap-px border-t bg-border">
      {["OUT", "OFF", "ON", "IN"].map(event => <div key={event} className="bg-card px-4 py-2">
        <dt className="text-xs font-medium text-muted-foreground">{event}</dt>
        <dd className="font-mono text-sm font-semibold">{oooi[event] ? `${oooi[event]}Z` : "—"}</dd>
      </div>)}
    </dl>
    {hits.length > 0 && <ul className="divide-y border-t" aria-label="SIGMETs on route">
      {hits.map(sigmet => <li key={sigmetId(sigmet)} className="px-4 py-2 font-mono text-xs">{sigmetTelex(sigmet)}</li>)}
    </ul>}
    {flightLog.length > 0 && <ol className="max-h-64 divide-y overflow-y-auto border-t" aria-label="ACARS messages">
      {flightLog.slice().reverse().map((entry, index) => <li key={index} className="flex gap-3 px-4 py-2 font-mono text-xs">
        <span className="shrink-0 text-muted-foreground">{new Date(entry.time * 1000).toISOString().slice(11, 16)}Z {entry.dir === "up" ? "▲" : "▼"} {entry.type}</span>
        <span className="min-w-0 break-words">{entry.text}</span>
      </li>)}
    </ol>}
  </section>
}

export function FlightFolder({ flight, setFlight, airports, openWeather, openCharts, view, setView, simbriefId, acars, openAipAvailable }) {
  const [username, setUsername] = useState(simbriefId || "")
  const [dispatchUsername, setDispatchUsername] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState("")

  async function onImport(event) {
    event.preventDefault()
    if (!username.trim() || busy) return
    setBusy(true)
    setError("")
    try {
      const importedUsername = username.trim()
      setFlight(await importDispatch(importedUsername, AbortSignal.timeout(25000)))
      setDispatchUsername(importedUsername)
      setImportOpen(false)
      setPdfError("")
      setView("briefing")
    } catch (error) {
      setError(error.name === "TimeoutError" ? "SimBrief took too long to respond. Try the import again." : error.message)
    } finally {
      setBusy(false)
    }
  }

  const [pdf, setPdf] = useState(null) // { flight, url } so a new import never shows the previous PDF

  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url) }, [pdf])

  async function loadPDF() {
    if (pdf?.flight === flight) return pdf.url
    setPdfBusy(true)
    setPdfError("")
    try {
      const response = await fetch("/ops/generate_pdf.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(flight),
        signal: AbortSignal.timeout(45000),
      })
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) {
        throw new Error("PDF unavailable")
      }
      const url = URL.createObjectURL(await response.blob())
      setPdf({ flight, url })
      return url
    } catch {
      setPdfError("The built-in PDF generator could not export this dispatch.")
      return null
    } finally {
      setPdfBusy(false)
    }
  }

  useEffect(() => {
    if (view === "pdf" && flight && pdf?.flight !== flight && !pdfBusy && !pdfError) loadPDF()
  }, [view, flight]) // eslint-disable-line react-hooks/exhaustive-deps

  async function downloadPDF() {
    const url = await loadPDF()
    if (!url) return
    const link = document.createElement("a")
    link.href = url
    link.download = `${flightNumber(flight) || "SimBrief"}_Briefing.pdf`
    link.click()
  }

  const origin = field(flight?.origin, "icao_code")
  const destination = field(flight?.destination, "icao_code")
  const fuel = field(flight?.fuel, "plan_ramp")
  const units = field(flight?.params, "units")
  const pdfUrl = dispatchPdfUrl(flight)
  const customPdfAvailable = /^(kgs?|lbs?)$/i.test(units ?? "")
  const alternates = airports.filter(item => item.role === "Alternate").map(item => item.code)
  const blockFuel = fuel != null && fuel !== "" && Number.isFinite(Number(fuel))
    ? new Intl.NumberFormat().format(Number(fuel)) + (units ? " " + units : "") : "—"

  return <div className="space-y-5">
    <PageBanner icon={FolderOpen} title="Flight Folder">
      <ExternalButton href="https://vamsys.io/phoenix/flight-center/booking">vAMSYS booking</ExternalButton>
      {flight && <Button className="touch-control" variant="secondary" onClick={() => setImportOpen(!importOpen)}><ArrowDownToLine />Import dispatch</Button>}
    </PageBanner>
    {(!flight || importOpen) && <ImportForm {...{ username, setUsername, onImport, busy, error }} hasFlight={Boolean(flight)} />}
    {!flight ? <>
      <section className="panel grid items-center gap-5 p-6 sm:grid-cols-[auto_1fr] sm:p-8" aria-busy={busy}>
        <div className="flex size-14 items-center justify-center rounded-lg bg-accent text-primary"><Plane className="size-6" /></div>
        <div>
          <h2 className="section-title">No active flight</h2>
          <p className="secondary-copy mt-1">Import a SimBrief dispatch to load the route, airport weather, and charts for your flight.</p>
          {busy ? <Skeleton className="mt-4 h-9 w-full max-w-56" /> :
            <div className="mt-4"><ExternalButton href="https://dispatch.simbrief.com">Open SimBrief</ExternalButton></div>}
        </div>
      </section>
    </> : <Tabs value={view} onValueChange={setView}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList className="module-tabs h-auto! max-w-full flex-wrap">
          <TabsTrigger className="px-4" value="briefing"><FolderOpen />Briefing</TabsTrigger>
          <TabsTrigger className="px-4" value="navlog"><Map />Navlog</TabsTrigger>
          <TabsTrigger className="px-4" value="ofp"><FileText />Full OFP</TabsTrigger>
          {customPdfAvailable && <TabsTrigger className="px-4" value="pdf"><FileType />IJV PDF</TabsTrigger>}
        </TabsList>
        <div className="flex flex-wrap gap-2">
          {customPdfAvailable && <Button className="touch-control" variant="outline" onClick={downloadPDF} disabled={pdfBusy}>
            <ArrowDownToLine />{pdfBusy ? "Preparing PDF…" : "Download IJV PDF"}
          </Button>}
          {pdfUrl ? <ExternalButton href={pdfUrl}>SimBrief PDF</ExternalButton> : !customPdfAvailable &&
            <ExternalButton href="https://dispatch.simbrief.com/">Get PDF in SimBrief</ExternalButton>}
        </div>
      </div>
      {pdfError && <Alert className="mt-3" variant="destructive"><CircleAlert /><AlertTitle>{pdfError}</AlertTitle>
        <AlertDescription><a className="underline" target="_blank" rel="noopener noreferrer" href={`https://createijvefb.streamlit.app/?${new URLSearchParams({ username: dispatchUsername })}`}>Open the IJV PDF generator</a></AlertDescription>
      </Alert>}
      <TabsContent className="mt-3" value="briefing">
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,17.5rem)]">
          <section className="order-1 min-w-0 overflow-hidden rounded-lg border border-[#5475b1] bg-route text-route-foreground lg:col-start-1 lg:row-start-1" aria-label="Flight summary">
            <div className="flex items-center gap-2 border-b border-[#5475b1] px-4 py-3 sm:px-5">
              <Plane className="size-4 text-route-muted" /><h2 className="section-title">Flight route</h2>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 px-4 py-5 sm:px-5 sm:py-6">
              {[[origin, flight.origin, "Departure", "est_out"], [destination, flight.destination, "Destination", "est_in"]].map(([code, airport, role, time], index) =>
                <div key={role} className={index === 1 ? "col-start-3 row-start-1 text-right" : ""}>
                  <p className="text-xs font-medium text-route-muted">{role}</p>
                  <p className="mt-1 font-mono text-3xl font-semibold tracking-tight sm:text-4xl">{code}</p>
                  <p className="mt-1 text-sm leading-snug text-route-muted">{field(airport, "name")}</p>
                  <p className="mt-2 font-mono text-sm text-route-foreground">{utc(field(flight.times, time))}</p>
                </div>)}
              <div className="col-start-2 row-start-1 mt-7 flex items-center gap-1.5 text-route-muted sm:gap-2" aria-hidden="true">
                <span className="hidden h-px w-8 bg-route-muted/60 sm:block xl:w-16" /><ArrowRight className="size-5" /><span className="hidden h-px w-8 bg-route-muted/60 sm:block xl:w-16" />
              </div>
            </div>
            <dl className="border-t border-[#5475b1] bg-black/10 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap gap-x-3 gap-y-1"><dt className="text-xs font-medium text-route-muted">Route</dt><dd className="min-w-0 break-words font-mono text-xs text-route-foreground">{field(flight.general, "route") || "—"}</dd></div>
            </dl>
          </section>
          <section className="panel order-2 min-w-0 overflow-hidden lg:col-start-2 lg:row-span-2 lg:row-start-1" aria-label="Dispatch details">
            <h2 className="section-title section-bar"><FileText className="size-4 text-data-accent" />Dispatch details</h2>
            <dl className="grid grid-cols-2 gap-px bg-border lg:grid-cols-1">
              <div className="min-w-0 bg-card px-4 py-3"><dt className="text-xs font-medium text-muted-foreground">Flight</dt><dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="font-mono">{flightNumber(flight) || "—"}</span>{flightAircraft(flight) && <Badge variant="secondary">{flightAircraft(flight)}</Badge>}</dd></div>
              <div className="min-w-0 bg-card px-4 py-3"><dt className="text-xs font-medium text-muted-foreground">Dispatch time</dt><dd className="mt-1 break-words font-mono text-sm"><time>{utc(field(flight.params, "time_generated"), true)}</time></dd></div>
              <div className="min-w-0 bg-card px-4 py-3"><dt className="text-xs font-medium text-muted-foreground">Block fuel</dt><dd className="mt-1 font-mono text-sm font-semibold text-data-accent">{blockFuel}</dd></div>
              <div className="min-w-0 bg-card px-4 py-3"><dt className="text-xs font-medium text-muted-foreground">Alternates</dt><dd className="mt-1 break-words font-mono text-sm font-semibold">{alternates.join(" / ") || "—"}</dd></div>
            </dl>
          </section>
          <section className="panel order-3 min-w-0 overflow-hidden lg:col-start-1 lg:row-start-2">
            <h2 className="section-title section-bar"><Map className="size-4 text-data-accent" />Airport briefing</h2>
            <ul className="divide-y">
              {airports.map(({ code, role }) => <li key={code} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-3"><span className="font-mono font-semibold text-data-accent">{code}</span><span className="text-sm text-muted-foreground">{role}</span></div>
                <div className="flex gap-2">
                  <Button className="touch-control" variant="outline" onClick={() => openWeather(code)} aria-label={`Weather for ${code}`}><CloudSun />Weather</Button>
                  <Button className="touch-control" variant="outline" onClick={() => openCharts(code)} aria-label={`Charts for ${code}`}><Map />Charts</Button>
                </div>
              </li>)}
            </ul>
          </section>
          {acars && <AcarsPanel key={field(flight.params, "request_id") || field(flight.params, "time_generated")} flight={flight} airports={airports} />}
        </div>
      </TabsContent>
      <TabsContent className="mt-3 min-w-0 space-y-4" value="navlog"><Navlog flight={flight} airports={airports} openAipAvailable={openAipAvailable} /></TabsContent>
      <TabsContent className="mt-3 space-y-4" value="ofp">
        <ExternalButton href="https://dispatch.simbrief.com/options/edit">Edit in SimBrief</ExternalButton>
        {field(flight.text, "plan_html") ? <iframe className="viewer bg-white" sandbox="" title="SimBrief operational flight plan" srcDoc={field(flight.text, "plan_html")} /> :
          <pre className="report">{field(flight.text, "plan_text") || "This dispatch has no full OFP document."}</pre>}
      </TabsContent>
      {customPdfAvailable && <TabsContent className="mt-3" value="pdf">
        {pdf?.flight === flight ? <iframe className="viewer h-[min(80svh,60rem)]! bg-white" title="IJV briefing PDF" src={pdf.url} /> :
          pdfBusy ? <Skeleton className="viewer" /> :
          <Button className="touch-control" variant="outline" onClick={loadPDF}><FileType />Generate IJV PDF</Button>}
      </TabsContent>}
    </Tabs>}
  </div>
}
