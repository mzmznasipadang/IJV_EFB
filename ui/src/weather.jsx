import { useEffect, useState } from "react"
import { Clipboard, Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Eye, Gauge, RotateCw, Search, Thermometer, Wind } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { forecastFields, formatOpenMeteoForecast } from "./metar"
import { PageBanner } from "./page-banner"

const models = {
  best_match: "Best Match",
  ecmwf_ifs: "ECMWF IFS",
  gfs_global: "NOAA GFS Global",
  icon_global: "DWD ICON Global",
}

async function getJSON(url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error("Weather data is temporarily unavailable.")
  return response.json()
}

async function getAirportData(airport, type, signal) {
  const query = new URLSearchParams({ proxy_weather: "1", type, icao: airport })
  const rows = await getJSON(`/ops/index.php?${query}`, signal)
  return rows?.[0]
}

async function getForecast(airport, model, signal) {
  const coordinates = await getAirportData(airport, "airport", signal)
  if (!Number.isFinite(coordinates?.lat) || !Number.isFinite(coordinates?.lon)) {
    throw new Error(`${airport} was not found in the OurAirports catalog.`)
  }
  const params = new URLSearchParams({
    latitude: coordinates.lat,
    longitude: coordinates.lon,
    hourly: forecastFields.join(","),
    models: model,
    forecast_hours: "24",
    temperature_unit: "celsius",
    wind_speed_unit: "kn",
    timezone: "UTC",
  })
  const { hourly } = await getJSON(`https://api.open-meteo.com/v1/forecast?${params}`, signal)
  return formatOpenMeteoForecast(airport, hourly)
}

function useWeatherReport(airport, refresh, type, model) {
  const key = JSON.stringify([airport, refresh, type, model])
  const [result, setResult] = useState({})
  useEffect(() => {
    if (!airport) return
    const controller = new AbortController()
    const { signal } = controller
    const timeout = window.setTimeout(() => {
      setResult({ key, error: "The weather request timed out. Try refreshing." })
      controller.abort()
    }, 25000)
    const request = type === "forecast"
      ? getForecast(airport, model, signal)
      : getAirportData(airport, type, signal)
    request.then(data => {
      if (!controller.signal.aborted) setResult({ key, data })
    }).catch(error => {
      if (!controller.signal.aborted) {
        setResult({ key, error: error.message })
      }
    }).finally(() => window.clearTimeout(timeout))
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [airport, refresh, type, model, key])
  return result.key === key ? result : { loading: Boolean(airport) }
}

function reportTime(input) {
  if (!input) return ""
  const date = new Date(typeof input === "number" ? input * 1000 : input)
  if (!Number.isFinite(date.valueOf())) return ""
  const iso = date.toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`
}

const categoryStyles = {
  VFR: "bg-[#16753c] text-white",
  MVFR: "bg-[#265ba8] text-white",
  IFR: "bg-[#a32837] text-white",
  LIFR: "bg-[#723c87] text-white",
}

function conditionsIcon(observed) {
  const weather = observed.wxString || ""
  if (weather.includes("TS")) return CloudLightning
  if (weather.includes("SN")) return CloudSnow
  if (/RA|DZ/.test(weather)) return CloudRain
  if (/FG|BR/.test(weather)) return CloudFog
  return observed.clouds?.some(cloud => /^(BKN|OVC|VV)$/.test(cloud.cover)) ? Cloud : CloudSun
}

function observationMetrics(observed) {
  const visibility = observed.visib == null ? NaN : Number.parseFloat(observed.visib) * 1.609344
  const qnh = observed.altim == null ? NaN : Number(observed.altim)
  const clouds = observed.clouds?.map(cloud => cloud.cover +
    (Number.isFinite(cloud.base) ? String(Math.round(cloud.base / 100)).padStart(3, "0") : "")).filter(Boolean)
  const direction = observed.wdir === "VRB" ? "VRB" :
    Number.isFinite(observed.wdir) ? String(observed.wdir).padStart(3, "0") + "°" : null
  return [
    ["Wind", Wind, observed.wspd == null ? null : [direction, observed.wspd + " KT"].filter(Boolean).join(" / ")],
    ["Visibility", Eye, Number.isFinite(visibility) ? (visibility >= 10 ? "10 km+" : `${Number(visibility.toFixed(1))} km`) : null],
    ["Temp / dew", Thermometer, [observed.temp, observed.dewp].some(value => value != null) ?
      [observed.temp, observed.dewp].map(value => value == null ? "—" : value + "°C").join(" / ") : null],
    ["Clouds", Cloud, clouds?.join(" · ") || null],
    ["QNH", Gauge, Number.isFinite(qnh) ? Math.round(qnh > 800 ? qnh : qnh * 33.8639) + " hPa" : null],
  ]
}

function RawWeather({ title, source, report, raw, action, children }) {
  return <section className="weather-raw">
    <div className="flex items-center justify-between gap-2">
      <h3 className="weather-label">{title}</h3>
      {action}
    </div>
    {source && <p className="mt-1 text-xs text-white/90">{source}</p>}
    {report.loading ? <Skeleton className="mt-2 h-8 w-full bg-white/20" aria-label={`Loading ${title}`} /> :
      report.error ? <p className="mt-2 text-sm" role="alert">{report.error}</p> :
        raw ? <pre>{raw}</pre> : <p className="mt-2 text-sm">No report available.</p>}
    {children}
  </section>
}

export function Weather({ airport, setAirport, flightAirports }) {
  const [query, setQuery] = useState("")
  const [model, setModel] = useState("best_match")
  const [refresh, setRefresh] = useState(0)
  const [copyStatus, setCopyStatus] = useState("")
  const metar = useWeatherReport(airport, refresh, "metar")
  const taf = useWeatherReport(airport, refresh, "taf")
  const forecast = useWeatherReport(airport, refresh, "forecast", model)
  const observed = metar.data
  const rawMetar = observed?.rawOb || observed?.rawMETAR
  const forecastText = forecast.data?.join("\n")
  const Conditions = observed ? conditionsIcon(observed) : null
  const dates = [reportTime(observed?.obsTime), reportTime(taf.data?.issueTime || taf.data?.reportTime)]

  async function copyReport(raw, label) {
    try {
      await navigator.clipboard.writeText(raw)
      setCopyStatus(label + " copied.")
    } catch {
      setCopyStatus("Select the report text to copy it.")
    }
  }

  return <div className="space-y-5">
    <PageBanner icon={CloudSun} title="Weather" detail={airport} />
    <section className="panel space-y-4 p-4 sm:p-5" aria-label="Weather controls">
      {flightAirports.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Flight airports">
        {flightAirports.map(({ code, role }) => <Button className="touch-control" key={code} variant={airport === code ? "default" : "outline"}
          aria-pressed={airport === code} onClick={() => { setAirport(code); setCopyStatus("") }}>
          <span className="font-mono">{code}</span><span>{role}</span>
        </Button>)}
      </div>}
      <div className="flex flex-wrap items-end gap-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault()
          setAirport(query)
          setRefresh(refresh + 1)
          setCopyStatus("")
        }}>
          <div>
            <Label htmlFor="weather-icao" className="mb-2">Airport ICAO</Label>
            <Input className="touch-control w-32 font-mono" id="weather-icao" value={query} maxLength={4}
              onChange={event => setQuery(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="WIII" required />
          </div>
          <Button className="touch-control" variant="outline" type="submit" disabled={query.length !== 4}><Search />Search</Button>
        </form>
        <div>
          <Label className="mb-2" htmlFor="weather-model">Forecast model</Label>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="touch-control min-w-44" id="weather-model"><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(models).map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {airport && <Button className="touch-control sm:ml-auto" variant="outline" onClick={() => setRefresh(refresh + 1)}><RotateCw />Refresh</Button>}
      </div>
    </section>
    {!airport ? <div className="panel flex items-center gap-3 p-5"><CloudSun className="size-5 text-primary" /><p className="secondary-copy">Search for an airport to view its weather.</p></div> : <>
      <section className="weather-surface" aria-label={`${airport} observed weather and TAF`}>
        <div className="flex items-center gap-2.5">
          <h2 className="font-mono text-2xl font-semibold">{airport}</h2>
          {categoryStyles[observed?.fltCat] && <Badge className={categoryStyles[observed.fltCat]}>{observed.fltCat}</Badge>}
        </div>
        <p className="secondary-copy mt-1">{dates[0] ? `Observed ${dates[0]} · Aviation Weather Center` : "Aviation Weather Center"}</p>
        {observed && <div className="my-5 flex items-center justify-between gap-4">
          <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            {observationMetrics(observed).map(([label, Icon, value]) => <div className="weather-metric" key={label}>
              <dt className="weather-label flex items-center gap-1.5"><Icon className="size-3.5 shrink-0" aria-hidden="true" />{label}</dt>
              <dd>{value ?? "—"}</dd>
            </div>)}
          </dl>
          {Conditions && <Conditions className="hidden size-18 shrink-0 text-white/85 md:block" strokeWidth={1.35} aria-hidden="true" />}
        </div>}
        <div className="weather-raw-stack">
          <RawWeather title="METAR" report={metar} raw={rawMetar} action={rawMetar &&
            <Button className="text-white hover:bg-white/15 hover:text-white" variant="ghost" size="icon-sm"
              aria-label="Copy METAR" title="Copy METAR" onClick={() => copyReport(rawMetar, "METAR")}><Clipboard /></Button>}>
            {rawMetar && Number(observed.obsTime) > 0 && Date.now() / 1000 - Number(observed.obsTime) > 7200 &&
              <p className="mt-2 text-sm text-amber-100" role="alert">This observation is more than two hours old.</p>}
          </RawWeather>
          <RawWeather title="TAF" source={dates[1]} report={taf} raw={taf.data?.rawTAF} />
        </div>
      </section>
      <section className="panel overflow-hidden">
        <header className="section-bar flex-wrap justify-between">
          <h2 className="section-title">Open-Meteo forecast</h2>
          <p className="text-xs text-muted-foreground">{models[model]} · {forecast.data?.length || 24} hourly periods · UTC</p>
        </header>
        <div className="p-4">
          {forecast.loading ? <Skeleton className="h-14 w-full" aria-label="Loading Open-Meteo forecast" /> :
            forecast.error ? <Alert variant="destructive"><AlertDescription>{forecast.error}</AlertDescription></Alert> :
              forecastText ? <pre className="report">{forecastText}</pre> :
                <p className="secondary-copy">No forecast available.</p>}
          {forecastText && <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="secondary-copy">Model estimates for simulation. Cloud bases are unavailable (///). Q groups use modeled sea-level pressure.</p>
            <Button className="touch-control" variant="outline" onClick={() => copyReport(forecastText, "Forecast")}><Clipboard />Copy forecast</Button>
          </div>}
        </div>
      </section>
    </>}
    <span role="status" className="secondary-copy">{copyStatus}</span>
  </div>
}
