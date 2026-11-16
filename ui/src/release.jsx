import { useEffect, useState } from "react"
import { CircleCheck, FileSignature } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { actualTakeoffFuel, dispatchFuelUnit, field, flightAirports, parseFuel, parseReleaseNumber } from "./dispatch"
import { EntryInput } from "./navlog"
import { getAirportData } from "./weather"

const number = new Intl.NumberFormat()
const num = (record, key) => { const value = Number(field(record, key)); return field(record, key) == null || field(record, key) === "" || !Number.isFinite(value) ? null : value }

function CrewField({ label, hint, ...props }) {
  return <div className="space-y-1.5">
    <span className="block text-sm font-medium">{label}</span>
    <EntryInput label={label} className="h-9 w-full text-base md:text-sm" {...props} />
    {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
  </div>
}

// Dispatch release with crew-entered actuals; values live in the dispatch's Navlog entries under "release"
export function Release({ flight, entries, updateEntry }) {
  const units = dispatchFuelUnit(flight) || field(flight.params, "units") || ""
  const release = entries.release ?? {}
  const update = patch => updateEntry("release", patch)
  const [signer, setSigner] = useState(release.signedBy || field(flight.crew, "cpt") || "")
  const takeoffFuel = actualTakeoffFuel(flight, entries)
  const weight = key => num(flight.weights, key)
  const overMax = (actual, max) => actual != null && max != null && actual > max ? `Above maximum ${number.format(max)}` : null
  const speed = { parse: value => parseReleaseNumber(value, { min: 80, max: 200 }), error: "Enter knots from 80 to 200." }
  const mass = { parse: value => parseReleaseNumber(value, { min: 1, max: 1000000 }), inputMode: "decimal", error: "Enter a positive weight." }
  const signed = Boolean(release.signedAt)

  return <div className="space-y-4">
    <section className="panel p-4 sm:p-5" aria-labelledby="release-actuals">
      <h3 id="release-actuals" className="section-title">Crew actuals</h3>
      <p className="secondary-copy mt-1">Values save when you leave a field and stay with this dispatch. Ramp fuel sets the actual takeoff fuel used by the Navlog and Fuel Monitoring.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CrewField label={`Actual ZFW${units ? ` (${units})` : ""}`} value={release.zfw == null ? "" : String(release.zfw)} placeholder={String(weight("est_zfw") ?? "")}
          {...mass} onCommit={zfw => update({ zfw })} hint={overMax(release.zfw, weight("max_zfw"))} />
        <CrewField label={`Actual TOW${units ? ` (${units})` : ""}`} value={release.tow == null ? "" : String(release.tow)} placeholder={String(weight("est_tow") ?? "")}
          {...mass} onCommit={tow => update({ tow })} hint={overMax(release.tow, weight("max_tow"))} />
        <CrewField label={`Ramp fuel${units ? ` (${units})` : ""}`} value={release.ramp == null ? "" : String(release.ramp)} placeholder={String(num(flight.fuel, "plan_ramp") ?? "")}
          parse={value => parseFuel(value, flight)} inputMode="decimal" error="Enter fuel from 0 up to 1.5 × block fuel."
          onCommit={ramp => update({ ramp })} hint={takeoffFuel != null ? `Takeoff fuel ${number.format(takeoffFuel)} (ramp − planned taxi)` : undefined} />
        <div className="grid grid-cols-3 gap-2">
          <CrewField label="V1" value={release.v1 == null ? "" : String(release.v1)} {...speed} onCommit={v1 => update({ v1 })} />
          <CrewField label="VR" value={release.vr == null ? "" : String(release.vr)} {...speed} onCommit={vr => update({ vr })} />
          <CrewField label="V2" value={release.v2 == null ? "" : String(release.v2)} {...speed} onCommit={v2 => update({ v2 })} />
        </div>
      </div>
      {release.v1 != null && release.vr != null && release.v2 != null && !(release.v1 <= release.vr && release.vr <= release.v2) &&
        <p role="status" className="mt-3 text-sm text-destructive">Check the speeds: expected V1 ≤ VR ≤ V2.</p>}
    </section>

    <section className="panel p-4 sm:p-5" aria-labelledby="release-signoff">
      <h3 id="release-signoff" className="section-title">Pilot entries</h3>
      <p className="secondary-copy mt-1">Both appear on the dispatch release above: fuel on line 11, your signature under Pilot in command.</p>
      <div className="mt-4 grid items-end gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]">
        <CrewField id="release-fuel-req" label={`Fuel req after brief${units ? ` (${units})` : ""}`} value={release.fuelReq == null ? "" : String(release.fuelReq)}
          placeholder={String(num(flight.fuel, "plan_ramp") ?? "")} parse={value => parseFuel(value, flight)} inputMode="decimal"
          error="Enter fuel from 0 up to 1.5 × block fuel." onCommit={fuelReq => update({ fuelReq })} />
        <div className="min-w-0 space-y-1.5">
          {signed ? <p className="flex min-h-9 flex-wrap items-center gap-2 text-sm">
            <Badge><CircleCheck />Signed</Badge>{release.signedBy} · {new Date(release.signedAt).toISOString().slice(0, 16).replace("T", " ")}Z
          </p> : <>
            <Label htmlFor="release-signer">Pilot in command</Label>
            <Input id="release-signer" className="h-9" value={signer} onChange={event => setSigner(event.target.value)} autoComplete="name" />
          </>}
        </div>
        {signed ? <Button variant="outline" className="touch-control" onClick={() => update({ signedBy: undefined, signedAt: undefined })}>Withdraw signature</Button> :
          <Button className="touch-control" disabled={!signer.trim()} onClick={() => update({ signedBy: signer.trim(), signedAt: Date.now() })}>
            <FileSignature />Sign release
          </Button>}
      </div>
    </section>
  </div>
}

// METAR and TAF for every airport on the dispatch
export function FlightWeather({ flight }) {
  const [reports, setReports] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    setReports(null)
    Promise.all(flightAirports(flight).map(async ({ code, role }) => {
      const [metar, taf] = await Promise.allSettled(["metar", "taf"].map(type => getAirportData(code, type, controller.signal)))
      return { code, role, metar: metar.value?.rawOb, taf: taf.value?.rawTAF, category: metar.value?.fltCat,
        failed: metar.status === "rejected" || taf.status === "rejected" }
    })).then(rows => { if (!controller.signal.aborted) setReports(rows) })
    return () => controller.abort()
  }, [flight])
  if (!reports) return <p role="status" className="panel secondary-copy p-5">Loading airport weather…</p>
  return <div className="grid gap-4 lg:grid-cols-2">
    {reports.map(({ code, role, metar, taf, category, failed }) => <section key={code} className="panel min-w-0 overflow-hidden">
      <h3 className="section-title section-bar justify-between"><span><span className="font-mono">{code}</span> · {role}</span>{category && <Badge variant="outline">{category}</Badge>}</h3>
      <div className="space-y-3 p-4">
        <div><p className="text-xs font-semibold text-muted-foreground">METAR</p><pre className="report mt-1">{metar || (failed ? "Could not load." : "No report available.")}</pre></div>
        <div><p className="text-xs font-semibold text-muted-foreground">TAF</p><pre className="report mt-1">{taf || (failed ? "Could not load." : "No report available.")}</pre></div>
      </div>
    </section>)}
  </div>
}
