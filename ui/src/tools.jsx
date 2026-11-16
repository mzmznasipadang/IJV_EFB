import { useState } from "react"
import { Gauge, NotebookPen, TriangleAlert, Users, Wind } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { field, flightNotams, flightNumber, windLevels, windMatrix } from "./dispatch"
import { PageBanner } from "./page-banner"

export function Performance({ flight }) {
  const raw = field(flight?.text, "tlr_section")
  const boundary = raw?.search(/=== LANDING ===|LANDING PERFORMANCE|LDG PERF|LANDING DATA|DATA FOR LANDING/i) ?? -1
  const takeoff = boundary >= 0 ? raw.slice(0, boundary).trim() : raw
  const landing = boundary >= 0 ? raw.slice(boundary).trim() : ""
  const fallback = flight ? "This dispatch has no performance data for this phase." : "Import a SimBrief dispatch to view takeoff and landing data."
  return <div className="space-y-5">
    <PageBanner icon={Gauge} title="Performance" detail={flightNumber(flight)} />
    <Tabs defaultValue="takeoff">
      <TabsList className="module-tabs"><TabsTrigger value="takeoff">Takeoff</TabsTrigger><TabsTrigger value="landing">Landing</TabsTrigger></TabsList>
      <TabsContent value="takeoff" className="mt-3"><pre className="report panel">{takeoff || fallback}</pre></TabsContent>
      <TabsContent value="landing" className="mt-3"><pre className="report panel">{landing || (raw ? "No separate landing report was identified. See Takeoff for the full dispatch data." : fallback)}</pre></TabsContent>
    </Tabs>
  </div>
}

export function Notes() {
  const [notes, setNotes] = useState(() => localStorage.getItem("efb_notes") || "")
  return <div className="space-y-5">
    <PageBanner icon={NotebookPen} title="Notes" />
    <section className="panel p-5">
      <Label className="mb-2" htmlFor="scratchpad">ATC scratchpad</Label>
      <p className="secondary-copy mb-3">Saved on this device</p>
      <Textarea className="min-h-[45svh] font-mono" id="scratchpad" value={notes}
        placeholder="Enter clearances, ATIS, or routing changes" onChange={event => {
          const value = event.target.value
          setNotes(value)
          localStorage.setItem("efb_notes", value)
        }} />
    </section>
  </div>
}

export function Manifest({ flight, rows }) {
  return <div className="space-y-5">
    <PageBanner icon={Users} title="Manifest" detail={flightNumber(flight)} />
    {!flight ? <p className="panel secondary-copy p-5">Import a SimBrief dispatch to generate a simulated manifest.</p> :
      <section className="panel overflow-hidden p-2">
        <Table>
          <TableCaption>Simulated crew and passenger manifest</TableCaption>
          <TableHeader><TableRow><TableHead>No.</TableHead><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Nationality</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(row => <TableRow key={row.id}>
            <TableCell>{row.id}</TableCell><TableCell>{row.name}</TableCell><TableCell>{row.role}</TableCell><TableCell>{row.nationality}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </section>}
  </div>
}

function notamTime(iso) {
  const date = new Date(iso)
  return iso && !Number.isNaN(date) ? date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + "Z" : ""
}

export function Notams({ flight }) {
  const groups = flightNotams(flight)
  return <div className="space-y-5">
    <PageBanner icon={TriangleAlert} title="NOTAMs" detail={flightNumber(flight)} />
    {!groups.length ? <p className="panel secondary-copy p-5">Import a SimBrief dispatch to view airport NOTAMs.</p> :
      <Tabs defaultValue="0">
        <TabsList className="module-tabs h-auto! max-w-full flex-wrap">{groups.map((group, tab) =>
          <TabsTrigger key={tab} value={String(tab)}>{group.code} · {group.role}</TabsTrigger>)}
        </TabsList>
        {groups.map((group, tab) => <TabsContent key={tab} value={String(tab)} className="mt-3 space-y-3">
          {!group.notams.length && <p className="panel secondary-copy p-5">SimBrief returned no NOTAMs for {group.code}.</p>}
          {group.notams.map((notam, index) => {
            const from = notamTime(notam.date_effective), to = notamTime(notam.date_expire)
            return <article key={notam.notam_id || index} className="panel space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{notam.notam_id}</span>
                {notam.score > 0 && <Badge variant="destructive">Priority</Badge>}
                {notam.notam_qcode_subject && <Badge variant="outline">{[notam.notam_qcode_subject, notam.notam_qcode_status].filter(Boolean).join(" · ")}</Badge>}
                {(from || to) && <span className="secondary-copy ml-auto">{from} – {to}</span>}
              </div>
              <pre className="report">{notam.text}</pre>
            </article>
          })}
        </TabsContent>)}
      </Tabs>}
  </div>
}

const pad3 = value => String(value).padStart(3, "0")

export function WindMatrix({ flight }) {
  const groups = windMatrix(flight)
  return <div className="space-y-5">
    <PageBanner icon={Wind} title="Wind Matrix" detail={flightNumber(flight)} />
    {groups.length > 0 && <p className="secondary-copy">Wind direction°/speed kt and OAT °C at each waypoint. The highlighted level is closest to the planned altitude.</p>}
    {!groups.length ? <p className="panel secondary-copy p-5">{flight ? "This dispatch has no wind data for its waypoints." : "Import a SimBrief dispatch to view winds and temperatures aloft."}</p> :
      groups.map(group => <section key={group.label} className="panel overflow-hidden p-2">
        <Table className="font-mono">
          <TableCaption className="caption-top mt-0 mb-2 text-left font-sans font-semibold text-foreground">{group.label}</TableCaption>
          <TableHeader><TableRow>
            <TableHead>Fix</TableHead>
            {windLevels.map(level => <TableHead key={level} className="text-center">FL{level / 100}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>{group.rows.map((row, index) => <TableRow key={`${row.ident}-${index}`}>
            <TableCell className="font-semibold">{row.ident}<span className="block text-xs font-normal text-muted-foreground">FL{pad3(Math.round(row.altitude / 100))}</span></TableCell>
            {row.cells.map((cell, column) => <TableCell key={column}
              className={`text-center ${column === row.nearest ? "bg-primary/10 font-semibold" : ""}`}>
              {cell ? <>{pad3(cell.dir)}/{pad3(cell.spd)}<span className="block text-xs text-muted-foreground">{cell.oat > 0 ? "+" : ""}{cell.oat}°</span></> : "—"}
            </TableCell>)}
          </TableRow>)}</TableBody>
        </Table>
      </section>)}
  </div>
}
