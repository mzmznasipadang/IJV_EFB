import { useEffect, useState } from "react"
import { ClipboardCheck, ExternalLink, FileText, Map, Pin, PinOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageBanner } from "./page-banner"

function procedure(name) {
  if (/\b(SID|DEPARTURE)\b/i.test(name)) return "Departure"
  if (/\b(STAR|ARRIVAL)\b/i.test(name)) return "Arrival"
  if (/\b(ILS|RNP|RNAV|LOC|VOR|APPROACH)\b/i.test(name)) return "Approach"
  if (/\b(DIAGRAM|GROUND|TAXI|PARKING)\b/i.test(name)) return "Ground"
  return "Airport documents"
}

function DocumentList({ files, selected, onSelect }) {
  return <ul className="space-y-1">
    {files.map(file => <li key={file.path}>
      <Button className="touch-control h-auto w-full justify-start px-3 py-2 text-left whitespace-normal"
        variant={selected?.path === file.path ? "secondary" : "ghost"} aria-pressed={selected?.path === file.path}
        onClick={() => onSelect(file)}><FileText />{file.name}</Button>
    </li>)}
  </ul>
}

function Viewer({ file, empty, action }) {
  return <div className="min-w-0">
    {file ? <section className="panel overflow-hidden">
      <div className="section-bar flex-wrap justify-between gap-2">
        <h2 className="section-title min-w-0 break-words">{file.name}</h2>
        <div className="flex flex-wrap gap-2">
          {action}
          <Button className="touch-control" variant="outline" asChild><a href={file.path} target="_blank" rel="noopener noreferrer">Open PDF <ExternalLink /></a></Button>
        </div>
      </div>
      <iframe className="viewer rounded-none border-0" src={file.path} title={file.name} />
    </section> : <div className="panel flex min-h-56 items-center justify-center gap-2 p-5 text-center">
      <FileText className="size-5 shrink-0 text-primary" /><p className="secondary-copy">{empty}</p>
    </div>}
  </div>
}

export function Charts({ catalog, airports, airport, setAirport, mode, setMode }) {
  const [selections, setSelections] = useState({})
  const [pins, setPins] = useState([])
  const [local, setLocal] = useState(null)
  useEffect(() => () => { if (local) URL.revokeObjectURL(local.path) }, [local])

  const folderNames = [...new Set([...airports.map(item => item.code), ...catalog.map(item => item.folder)])]
  const activeFolder = folderNames.includes(airport) ? airport : folderNames[0]
  const catalogFiles = catalog.find(item => item.folder === activeFolder)?.files || []
  const procedures = [...new Set(catalogFiles.map(file => procedure(file.name)))]
  const current = selections[activeFolder]
  const pinned = pins.some(file => file.path === current?.path)

  function selectFile(file) {
    setSelections(previous => ({ ...previous, [file.folder]: file }))
  }

  function togglePin(file) {
    setPins(pinned ? pins.filter(pin => pin.path !== file.path) : [...pins, file])
  }

  return <div className="space-y-5">
    <PageBanner icon={Map} title="Charts">
      <Button className="touch-control" variant="outline" asChild>
        <a href="https://charts.navigraph.com" target="_blank" rel="noopener noreferrer">Open Navigraph <ExternalLink /></a>
      </Button>
    </PageBanner>
    {airports.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Flight chart airports">
      {airports.map(({ code, role }) => <Button className="touch-control" key={code} variant={activeFolder === code && mode === "ijv" ? "default" : "outline"}
        aria-pressed={activeFolder === code && mode === "ijv"} onClick={() => { setAirport(code); setMode("ijv") }}>
        <span className="font-mono">{code}</span><span>{role}</span>
      </Button>)}
    </div>}
    <Tabs value={mode} onValueChange={setMode}>
      <TabsList className="module-tabs"><TabsTrigger value="ijv"><Map />IJV charts</TabsTrigger><TabsTrigger value="local"><FileText />Local PDF</TabsTrigger></TabsList>
      <TabsContent className="mt-3" value="ijv">
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(14rem,19rem)_minmax(0,1fr)]">
          <aside className="panel space-y-4 p-4" aria-label="Chart library">
            {folderNames.length > 0 && <div>
              <Label className="mb-2" htmlFor="chart-airport">Airport or folder</Label>
              <Select value={activeFolder} onValueChange={setAirport}>
                <SelectTrigger className="touch-control w-full" id="chart-airport"><SelectValue /></SelectTrigger>
                <SelectContent>{folderNames.map(folder => <SelectItem key={folder} value={folder}>{folder}</SelectItem>)}</SelectContent>
              </Select>
            </div>}
            {pins.length > 0 && <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Pin className="size-4 text-primary" />Pinned charts</h2>
              <DocumentList files={pins} selected={current} onSelect={file => { setAirport(file.folder); selectFile(file) }} />
            </section>}
            {procedures.map(group => <section key={group}>
              <h2 className="mb-1 text-sm font-semibold text-muted-foreground">{group}</h2>
              <DocumentList files={catalogFiles.filter(file => procedure(file.name) === group)} selected={current}
                onSelect={file => selectFile({ ...file, folder: activeFolder })} />
            </section>)}
            {!catalogFiles.length && <p className="secondary-copy">No IJV PDFs are available for this airport. Open Navigraph or select a local PDF.</p>}
          </aside>
          <Viewer file={current} empty="Select a chart from the library." action={current &&
            <Button className="touch-control" variant={pinned ? "secondary" : "outline"} aria-pressed={pinned} onClick={() => togglePin(current)}>
              {pinned ? <PinOff /> : <Pin />}{pinned ? "Unpin chart" : "Pin chart"}
            </Button>} />
        </div>
      </TabsContent>
      <TabsContent className="mt-3 space-y-4" value="local">
        <div className="panel p-4">
          <Label className="mb-2" htmlFor="local-chart">Open a PDF from this device</Label>
          <Input type="file" id="local-chart" className="touch-control max-w-lg" accept="application/pdf,.pdf"
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) setLocal({ name: file.name, path: URL.createObjectURL(file) })
            }} />
        </div>
        <Viewer file={local} empty="Choose a local PDF to view it here." />
      </TabsContent>
    </Tabs>
  </div>
}

export function Checklists({ catalog, aircraft }) {
  const [selection, setSelection] = useState(null)
  const [chosenFolder, setChosenFolder] = useState("")
  const matching = catalog.find(item => aircraft && item.files.some(file => file.name.toUpperCase().startsWith(aircraft)))
  const folder = catalog.find(item => item.folder === chosenFolder) || matching || catalog[0]

  return <div className="space-y-5">
    <PageBanner icon={ClipboardCheck} title="Checklists" />
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(14rem,19rem)_minmax(0,1fr)]">
      <aside className="panel space-y-4 p-4">
        {folder ? <>
          <Select value={folder.folder} onValueChange={setChosenFolder}>
            <SelectTrigger aria-label="Checklist folder" className="touch-control w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{catalog.map(item => <SelectItem key={item.folder} value={item.folder}>{item.folder}</SelectItem>)}</SelectContent>
          </Select>
          <DocumentList files={folder.files} selected={selection} onSelect={setSelection} />
        </> : <p className="secondary-copy">No checklists are available.</p>}
      </aside>
      <Viewer file={selection} empty="Select an aircraft checklist." />
    </div>
  </div>
}
