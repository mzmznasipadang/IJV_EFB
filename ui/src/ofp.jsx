import { ChevronRight, Circle, CircleCheck } from "lucide-react"
import { Button } from "@/components/ui/button"

// The two crew entries the dispatch release asks for; each opens its field on the Dispatch Release tab
export function PilotEntries({ release = {}, openEntry }) {
  const items = [
    ["Fuel req after brief", release.fuelReq != null, "release-fuel-req"],
    ["PIC signature (release)", Boolean(release.signedAt), "release-signer"],
  ]
  const done = items.filter(([, complete]) => complete).length
  return <div className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5" role="group" aria-label="Pilot entries">
    <span className="text-sm font-medium text-muted-foreground">Pilot entries:</span>
    {items.map(([label, complete, target]) => <Button key={label} variant="ghost" size="sm" className="touch-control md:min-h-9" onClick={() => openEntry(target)}
      aria-label={`${label}: ${complete ? "done" : "to do"}. Go to field`}>
      {complete ? <CircleCheck className="text-data-accent" /> : <Circle />}{label}<ChevronRight className="text-muted-foreground" />
    </Button>)}
    <span className={`ml-auto font-mono text-sm tabular-nums ${done === items.length ? "text-data-accent" : "text-muted-foreground"}`} aria-live="polite">{done}/{items.length} done</span>
  </div>
}

// Monospaced OFP document; scrolls sideways on narrow screens instead of wrapping columns
export function OfpDocument({ title, children }) {
  return <section className="panel navlog-print min-w-0 overflow-hidden" aria-label={title}>
    <pre className="ofp-document" tabIndex={0} role="region" aria-label={`${title} document`}>{children}</pre>
  </section>
}
