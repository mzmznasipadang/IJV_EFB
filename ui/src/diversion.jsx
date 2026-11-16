import { useEffect, useId, useMemo, useState } from "react"
import { LifeBuoy } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { dispatchFuelUnit, field, longitudeNear, navlogLegs, navlogMapRoutes } from "./dispatch"
import { burnPerNm, diversionPosition, rankDiversions } from "./diversion"
import { NavlogMap } from "./navlog-map"
import { PageBanner } from "./page-banner"
import { getAirportData } from "./weather"

const radiusNm = 300
const weatherCount = 10
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const categoryColors = { VFR: "#1a7f37", MVFR: "#1f5fbf", IFR: "#c62828", LIFR: "#a0207a", unknown: "#6b7280" }

async function getDiversionAirports([lat, lon], signal) {
  const query = new URLSearchParams({ diversion_airports: "1", lat, lon, radius: radiusNm })
  const response = await fetch(`/ops/index.php?${query}`, { signal })
  if (!response.ok) throw new Error("The airport catalogue is temporarily unavailable. Try again shortly.")
  return response.json()
}

// Candidate airports near the position, then METARs for the nearest few
function useCandidates(position) {
  const [lat, lon] = position ?? []
  const [state, setState] = useState({})
  useEffect(() => {
    if (lat == null) return
    const controller = new AbortController()
    const { signal } = controller
    setState({ loading: true })
    getDiversionAirports([lat, lon], signal).then(candidates => {
      if (signal.aborted) return
      setState({ candidates, wx: {}, wxLoading: true })
      return Promise.allSettled(candidates.slice(0, weatherCount).map(airport =>
        getAirportData(airport.icao, "metar", signal).then(metar => [airport.icao, metar])))
        .then(results => {
          if (signal.aborted) return
          const wx = Object.fromEntries(results.filter(result => result.status === "fulfilled" && result.value[1]).map(result => result.value))
          setState({ candidates, wx, wxFailed: results.some(result => result.status === "rejected") })
        })
    }).catch(error => {
      if (!signal.aborted) setState({ error: error.message })
    })
    return () => controller.abort()
  }, [lat, lon])
  return state
}

export function Diversion({ flight, airports, entries = {}, openAipAvailable }) {
  const departure = field(flight?.origin, "icao_code")
  const legs = useMemo(() => navlogLegs(flight?.navlog, departure), [flight, departure])
  const routes = useMemo(() => navlogMapRoutes(legs, []), [legs])
  const units = dispatchFuelUnit(flight)
  const reserve = Number(field(flight?.fuel, "reserve"))
  const finalReserve = reserve > 0 ? reserve : null
  const burn = useMemo(() => burnPerNm(legs), [legs])
  const [selected, setSelected] = useState("auto")
  const [minRunwayText, setMinRunwayText] = useState("6000")
  const minRunwayFt = Number(minRunwayText) > 0 ? Number(minRunwayText) : 6000
  const here = diversionPosition(legs, entries, selected === "auto" ? null : Number(selected))
  const position = here?.leg.position
  const { candidates, wx, wxLoading, wxFailed, loading, error } = useCandidates(position)
  const ranked = useMemo(() => candidates && position ? rankDiversions(candidates, {
    position, fuelOnBoard: here.fuelOnBoard, burnPerNm: burn, minRunwayFt, finalReserve, wx, unit: units,
  }) : [], [candidates, position, here?.fuelOnBoard, burn, minRunwayFt, finalReserve, wx, units])
  const markers = useMemo(() => ranked.slice(0, 10).map((result, index) => ({
    position: [result.airport.lat, longitudeNear(result.airport.lon, position[1])],
    label: `${index + 1} ${result.airport.icao}`,
    title: `${result.airport.name} · ${result.category}${result.eligible ? "" : " · runway too short"}`,
    color: result.eligible ? categoryColors[result.category] : categoryColors.unknown,
  })), [ranked, position])
  const selectId = useId()
  const runwayId = useId()
  const fuel = value => value == null ? "—" : `${number.format(value)}${units ? ` ${units}` : ""}`

  if (!here) return <div className="space-y-4">
    <PageBanner icon={LifeBuoy} title="Diversion" />
    <p className="panel secondary-copy p-5">SimBrief supplied no waypoint coordinates for this dispatch, so no position is available.</p>
  </div>

  return <div className="space-y-4">
    <PageBanner icon={LifeBuoy} title="Diversion" detail={`From ${here.leg.ident} · ${here.source}`} />
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={selectId}>Position</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id={selectId} className="touch-control min-w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Latest Navlog ATO (automatic)</SelectItem>
            {legs.map((leg, index) => leg.position && <SelectItem key={index} value={String(index)}>{index + 1}. {leg.ident}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={runwayId}>Minimum runway (ft)</Label>
        <Input id={runwayId} type="number" inputMode="numeric" min="1" step="100" className="touch-control w-36"
          value={minRunwayText} onChange={event => setMinRunwayText(event.target.value)} />
      </div>
    </div>
    <p className="secondary-copy">
      Position: {here.leg.ident} ({here.source}). Fuel on board: {fuel(here.fuelOnBoard)}{here.fuelPlanned ? " (planned — no actual fuel entered here)" : " (actual)"}.
      {" "}Airports within {radiusNm} NM are ranked by an open runway of at least {number.format(minRunwayFt)} ft, then estimated fuel on landing
      against the {finalReserve == null ? "final reserve (not in this dispatch)" : `${fuel(finalReserve)} final reserve`}, then METAR flight category (VFR and MVFR equal, IFR and LIFR lower)
      (fetched for the {weatherCount} nearest), then distance. Fuel on landing uses the route's average planned burn
      {burn == null ? " (not available in this dispatch)" : ` of ${burn.toFixed(1)}${units ? ` ${units}` : ""}/NM`} over the great-circle distance.
      Approach availability has no free data source and is not used in the ranking.
    </p>
    <NavlogMap routes={routes} flight={flight} airports={airports} openAipAvailable={openAipAvailable} markers={markers} />
    {loading && <p role="status" className="panel secondary-copy p-5">Finding airports near {here.leg.ident}…</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {candidates && !candidates.length && <p role="status" className="panel secondary-copy p-5">No large or medium airports within {radiusNm} NM of {here.leg.ident}.</p>}
    {ranked.length > 0 && <div className="panel min-w-0 overflow-hidden">
      <p role="status" className="secondary-copy border-b px-4 py-2">
        {wxLoading ? "Loading METARs…" : wxFailed ? "Some METARs could not load; those airports show unknown weather." : `${ranked.length} airports ranked.`}
      </p>
      <div role="region" aria-label="Ranked diversion airports" tabIndex={0} className="overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring">
        <table className="w-full min-w-[60rem] text-sm">
          <caption className="caption-top border-b bg-toolbar px-4 py-3 text-left font-semibold">Diversion airports ranked from {here.leg.ident}</caption>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead scope="col" className="px-4">#</TableHead>
              <TableHead scope="col">ICAO</TableHead>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col" className="text-right">Distance (NM)</TableHead>
              <TableHead scope="col" className="text-right">Longest runway (ft × ft)</TableHead>
              <TableHead scope="col">Weather</TableHead>
              <TableHead scope="col">Approach</TableHead>
              <TableHead scope="col" className="text-right">{`Est. fuel on landing${units ? ` (${units})` : ""}`}</TableHead>
              <TableHead scope="col" className="pr-4">Reasons</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono tabular-nums">
            {ranked.map((result, index) => {
              const { airport, longestRunway: runway } = result
              const metar = wx?.[airport.icao]
              return <TableRow key={airport.icao} className={result.eligible ? "" : "text-muted-foreground"}>
                <TableCell className="px-4">{index + 1}</TableCell>
                <TableHead scope="row" className="font-semibold">{airport.icao}</TableHead>
                <TableCell className="font-sans">{airport.name}</TableCell>
                <TableCell className="text-right">{number.format(result.distanceNm)}</TableCell>
                <TableCell className="text-right">{runway ? `${number.format(runway.lengthFt)}${runway.widthFt ? ` × ${number.format(runway.widthFt)}` : ""}` : "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline" title={metar?.rawOb ?? "No METAR"}>{result.category === "unknown" ? "Unknown" : result.category}</Badge>
                  {metar?.rawOb && <span className="sr-only"> {metar.rawOb}</span>}
                </TableCell>
                <TableCell className="font-sans text-muted-foreground">Not available</TableCell>
                <TableCell className={`text-right ${result.fuelOnLanding != null && finalReserve != null && result.fuelOnLanding < finalReserve ? "text-destructive" : ""}`}>
                  {result.fuelOnLanding == null ? "—" : number.format(result.fuelOnLanding)}
                </TableCell>
                <TableCell className="pr-4 font-sans text-xs">{result.reasons.join(" · ")}</TableCell>
              </TableRow>
            })}
          </TableBody>
        </table>
      </div>
    </div>}
  </div>
}
