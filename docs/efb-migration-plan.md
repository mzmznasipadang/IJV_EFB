# EFB migration plan

Implementation plan for [efb-migration-todo.md](efb-migration-todo.md). The work runs in this order:

**1 (deploy Map) → 2 (Navlog entries and Fuel Monitoring) → 3 (OFP and release) → 4 (Diversion)**

- Section 3 depends on section 2: it supplies actual takeoff fuel as the baseline for Fuel Monitoring.
- Section 4 depends on sections 2 and 3 for fuel on board.

All new logic that doesn't depend on React goes into `ui/src/dispatch.js`, with tests in `ui/src/dispatch.test.js` (run with `node --test src/dispatch.test.js` from `ui/`). React code stays in the existing view files.

## 1. Deploy the homepage Map (gate: user)

The Map work is still uncommitted in five files: `home.jsx`, `main.jsx`, `navlog-map-briefing.js`, `navlog-map.jsx` and `navlog.jsx`.

1. The user reviews and commits those files, then pushes `main`. That push starts `.gitea/workflows/deploy.yml`.
2. In production, check that the Map tile opens the Indonesia overview with no dispatch loaded, that OpenAIP tiles load (the `openAipAvailable` config is set on the server), and that routes fit once a dispatch is imported.
3. Tick the last item in section 1 of the checklist.

## 2. Editable Navlog and Fuel Monitoring

### Data model (`dispatch.js`)

- **Dispatch ID:** `request_id || time_generated`, the same ID `flight.jsx:68` and `:340` already use. Move it into a shared helper, `dispatchId(flight)`, and use it in both places.
- **Entry key:** `${route}:${legIndex}`, where `route` is `p` for the primary route or `a0`, `a1`, … for the alternates. Don't key by waypoint ident: TOC and TOD repeat, and the primary and alternate routes share fixes.
- **Entry fields:** `{ note, eto, ato, fuel, checkedAt }`. Times are UTC strings in `HHMM` format. `fuel` is a number in the dispatch unit.
- **Storage:** one localStorage key, `ijv-efb-navlog:${callsign}`, holding `{ dispatchId, entries }`, following the same pattern as `saveDispatch` and `loadDispatch`. When `activateFlight` runs in `main.jsx` and the stored `dispatchId` differs from the new flight's, it starts with empty entries; the old record is overwritten on the first save. This is how a newly imported dispatch gets its own entries. Expiry follows the existing 48 h dispatch age, because the record is only read while that dispatch is active.
- **Unit:** move the kg/lb parse from `navlog.jsx` into `dispatchFuelUnit(flight)` so the Navlog and Fuel Monitoring share it.

### Validation

- **Times:** `^([01]\d|2[0-3])[0-5]\d$`. Accept an empty value to clear the field.
- **Fuel:** a finite number, at least 0 and at most `plan_ramp × 1.5`. Reject anything else with an inline error, and don't save rejected values.

### Navlog UI (`navlog.jsx`)

- Add a search input above the tables that filters rows by ident or airway. Use the existing `Input` component.
- Add editable cells for ETO, ATO, actual fuel and note, using `Input` with `inputMode="numeric"`. Save on blur. Use labels associated with each cell for accessibility.
- Show the planned ETO as a placeholder: the off-block time plus `leg.elapsed`.
- **Fuel-check reminder:** flag the next row that has passed its planned ETO but has no actual fuel. Show the flag as a badge on the row and a note on the Fuel Monitoring page. No timers or notifications.

### Fuel Monitoring (new view, enabled from the Home tile)

- Add a `fuelStatus(legs, entries, baseline)` function that returns, for each checked waypoint, the planned fuel, the actual fuel and the deviation (actual minus planned). It also returns the latest check and the estimated fuel at destination: planned destination fuel plus the latest deviation. The estimate is `null` until at least one actual fuel value exists.
- As built, `fuelStatus(legs, entries)` has no `baseline` parameter. Section 3 should feed actual takeoff fuel in, either as a takeoff entry (`p:0`) or by adding the parameter.
- Show a table that matches the Navlog's style, and make each row link to its Navlog entry (switch to the Navlog view and scroll to the row's anchor).
- In `home.jsx`, give the "Fuel Monitoring" tile `open` and `disabledReason: requiresFlight`.

### Tests (`dispatch.test.js`)

- Key stability across primary and alternate routes and repeated idents.
- A new dispatch ID resets the entries; the same ID keeps them.
- Validation edge cases: `2359`, `2400`, `0960`, negative fuel, fuel above the cap, and empty input.
- `fuelStatus`: no actuals gives a `null` estimate; one actual or several actuals give the correct deviation and estimate.

### Open questions

- Still open: is SimBrief `navlog.fix.time_total` measured from takeoff (`times.est_off`) or from off-block (`est_out`)? The code assumes takeoff (see the shortcut comment in `takeoffTime`). Check against a real OFP.
- Is "fuel left" for the alternates also `fuel_plan_onboard`, measured from the destination? It affects only the alternate rows.

## 3. OFP and dispatch release

- **Tabs:** extend the existing OFP view in `flight.jsx` and `documents.jsx` with the existing `Tabs` component: briefing text, release, flight plan, NOTAMs (reuse `flightNotams`) and weather (reuse `weather.jsx` and `metar.js`). Keep the IJV PDF export as it is.
- **Crew fields:** actual ZFW, TOW, ramp fuel, V1, VR, V2 and pilot sign-off, stored by dispatch ID with the same pattern as section 2. Add tests for the validators.
- **Actual takeoff fuel:** ramp fuel minus planned taxi fuel, passed to `fuelStatus` as `baseline` once it has been entered.
- **Open questions:**
  - Which SimBrief fields hold the plain-text briefing and the release? Candidates are `text.plan_html` and the `files` links; check them against a real response.
  - What does pilot sign-off record: a name and UTC time, or an ACARS telex as well?

## 4. Diversion (gate: sources)

1. **Decision gate:** confirm a source for each input before writing any code.

   | Input | Source |
   |---|---|
   | Airport and runway dimensions | Unknown. Options are the OpenAIP API (the key is already configured for tiles) or a static dataset. |
   | Approach availability | Unknown |
   | Airport weather | `metar.js` exists; confirm it can fetch weather for any ICAO code, not only the planned airports. |
   | Simulator position | No feed is known. The ACARS config handles telex, not position. The fallback is the last Navlog waypoint with an ATO. |
   | Fuel on board | The latest actual fuel from section 2. The fallback is the planned fuel at the current waypoint. |

2. Only after the gate: write a ranking function `rankDiversions(candidates, position, fob, wx)` in `dispatch.js` with tests. It returns a score and the reasons behind it. Each fallback value is marked with a source of `"fallback"` so the UI can label it.
3. Enable the Diversion tile. Show the candidate airports on the existing `NavlogMap` and a ranked list that shows the reasons for each ranking and any fallback labels.

## Later candidates

These stay out of scope until sections 3 and 4 are done.

- The loadsheet would reuse the actual weights from section 3.
- The vertical profile would use `leg.altitude` and `leg.totalDistance`, which are already available.
