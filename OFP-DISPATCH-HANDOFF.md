# IJV EFB OFP dispatch handoff

Research completed on 16 November 2026. The dispatch service is already running on the production server. This investigation made no changes to either app and did not generate a PDF from a real pilot’s dispatch.

## Current deployment

| Service | Public URL | Server path on `naspad-server` | Local binding |
| --- | --- | --- | --- |
| IJV EFB | [Flight Deck](https://efb.ijvirtual.org/ops/index.php) | `/opt/ijv-efb` | `127.0.0.1:8081` |
| IJV EFB Dispatch | [Dispatch generator](https://dispatch.indonesiajourneyvirtual.site/) | `/opt/ijv-efb-dispatch` | `127.0.0.1:8501` |

SSH entry point is `ssh root@naspad-server`. Tailscale may require an identity check. The dispatch container is `ijv-efb-dispatch-web-1`, and its running `/app/IJV.py` matched the server checkout at `/opt/ijv-efb-dispatch/repo/IJV.py`. Both the public and loopback Streamlit health endpoints returned `200` with `ok`. The public app loaded its sign-in form and initialized its Streamlit connection in Chromium.

## Current OFP flow

- `ui/src/dispatch.js` imports the latest dispatch from SimBrief and extracts the source OFP PDF URL when available.
- `ui/src/flight.jsx` displays the imported dispatch in the Flight Folder. It opens the original SimBrief PDF when available or calls the authenticated `POST /ops/generate_pdf.php` for a kilogram dispatch. If that local export fails, it offers the older Streamlit Cloud generator.
- The self-hosted Streamlit app fetches a dispatch from SimBrief and renders a custom PDF with WeasyPrint. It exposes a preview and a download button in its browser UI. I found no dedicated endpoint that accepts an imported dispatch payload and returns a PDF directly.

## Integration issues

1. **Authentication.** The deployed dispatch app trusts a URL-supplied username as proof of sign-in. Review and replace that behavior before exposing the generator through the EFB. Keep any renderer endpoint private and authenticate calls from the EFB server.
2. **Dispatch identity.** The Streamlit app fetches the latest SimBrief plan by username at export time. If a newer plan was generated after import, that PDF may describe a different flight from the one open in the Flight Folder.
3. **Units.** The custom template hardcodes `KGS` around values from SimBrief. A pounds-based dispatch can therefore be mislabeled. The EFB already limits its local custom export to kilograms and offers the original SimBrief PDF when available.

## Suggested implementation

- [ ] Extract the WeasyPrint renderer into a function that accepts the complete imported SimBrief payload and returns PDF bytes. Keep the Streamlit browser UI as a separate caller if it is still needed.
- [ ] Expose the renderer to the EFB backend over a private service connection. Use a shared Docker network or another verified private route. The host’s `127.0.0.1:8501` address resolves differently from loopback inside the EFB container.
- [ ] Send the dispatch already loaded in the Flight Folder through the authenticated EFB endpoint. Validate the payload, set request and response limits, and return `application/pdf` with a filename derived from that dispatch.
- [ ] Read and validate the dispatch units before rendering. Support both `KGS` and `LBS` with accurate labels, or limit custom export to supported units and keep the original SimBrief PDF available.
- [ ] Verify with two fixture dispatches, one in kilograms and one in pounds. Confirm that the PDF matches the imported flight even after a newer SimBrief plan exists. Check unauthenticated access, renderer timeout handling, and the original PDF fallback before deploying.

## Status — implemented 16 November 2026

- **Renderer:** the WeasyPrint OFP code moved out of `IJV.py` into `ofp_render.py` (`render_pdf(dispatch) -> bytes`). The Streamlit app calls it. The template is unchanged apart from the unit labels.
- **Private service:** `render_api.py` runs as the `renderer` service in `/opt/ijv-efb-dispatch/compose.yml`. It has no host port and listens on `ijv-efb_default` as `ofp-renderer:8502`. It requires the `X-Render-Token` header and allows a 5 MB body and 2 concurrent renders. The token is in `/opt/ijv-efb-dispatch/.env` and `/opt/ijv-efb/.env` (mode 600).
- **SSRF guard:** WeasyPrint only fetches `data:` URIs and HTTPS from `simbrief.com`, with no redirects.
- **EFB:** `ops/generate_pdf.php` sends the open dispatch to the renderer (30 s timeout). On any failure it uses Dompdf. The EFB image now includes GD; without it, Dompdf failed on every real plan because SimBrief maps are GIFs.
- **Units:** both renderers label weights from `params.units` (KGS/LBS). The UI now allows custom export for lbs plans.
- **Tests:** real SimBrief plan BDL807 WIII–WIKK, in kg and in lbs, through the renderer and through Dompdf: correct labels, 16 pages. A request without an EFB session gets a 401, a wrong token gets a 401, and internal/metadata/file URLs are blocked.
- **Backups:** `/opt/ijv-efb.bak-20261116` and `/opt/ijv-efb-dispatch.bak-20261116`.
- **Not committed:** the dispatch changes are not committed to `Murazan/ijv-efb-dispatch`. A `git pull` there will conflict with `IJV.py`.
- **Sign-in bypass closed (16 Nov):** `?username=` now only prefills the SimBrief field after login. The only gate left is the shared password `IJV1`, which is hardcoded in `IJV.py` and in the GitHub repo. **Still open:** The EFB error fallback link still points to `createijvefb.streamlit.app`.
- **Ops note:** the renderer holds a connection to the `ijv-efb_default` network, so `docker compose down` in `/opt/ijv-efb` fails with "active endpoints". Stop the renderer first. If that network is ever recreated, run `docker compose up -d` in `/opt/ijv-efb-dispatch` so the renderer reconnects.
- **Local copy:** `ops/ijv-efb-dispatch/` holds the deployed files on top of an old clone's `.git`. Don't commit or push from that folder. The old CLI script is now `Backup/IJV.cli-old.py`.
- **Live check:** after a real "Download OFP PDF" click, `docker logs ijv-efb-dispatch-renderer-1 --since 10m | grep 'POST /render'` should show a 200.

## Hoppie ACARS — 16 November 2026

- **Station:** telexes go from `IJVOPS` (`HOPPIE_STATION`) with the VA logon in `HOPPIE_LOGON` (`/opt/ijv-efb/.env`). Shared client: `ops/hoppie.php`.
- **EFB panel (Flight Folder → Briefing, shown when the pilot picks Hoppie at login):** SIGWX watch (SIGMETs on route, every 10 min while the tab is open), Weather / OFP summary / NOTAM digest buttons, an automatic "new dispatch issued" notice, OOOI times and the message log.
- **Poller:** the `hoppie-poller` service polls `IJVOPS` every 45–75 s, answers `WX WIII [WSSS ...]` with METAR/TAF, and logs every downlink to the `acars` volume (`/var/lib/ijv-acars/<CALLSIGN>.json`). Run only one poller: a poll consumes the station's messages.

### Todo

- [ ] **Parking stand at TOD.** Send a `STAND xx` telex when the flight reaches top of descent.
  - Stand source: vAMSYS. Check that vAMSYS exposes a stand or gate assignment and which OAuth scope it needs. The EFB now asks only for `identity:basic pilot:read`.
  - TOD trigger: aircraft position reports over Hoppie (`position` downlinks the poller already logs), or the vAMSYS live-flight position. Compare with the SimBrief `TOD` navlog fix.
  - It belongs in `docker/hoppie_poll.php`, so it works with the EFB tab closed.
- [ ] Move the SIGWX check into the poller so alerts work with the tab closed.
- [ ] Feed OOOI times into vAMSYS if its API accepts them.
