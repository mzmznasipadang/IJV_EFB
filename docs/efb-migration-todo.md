# EFB migration checklist

Use the [reference IJV Crew EFB](https://efb.indonesiajourneyvirtual.site/) as a guide for the crew workflows. Build on our existing SimBrief import, OFP renderer, Navlog, and OpenAIP map. Direct code reuse depends on access to the reference source repository.

## 1. Homepage Map

- [x] Replace the homepage Charts tile with Map.
- [x] Open an Indonesia overview without a dispatch and fit the primary and alternate routes when waypoint coordinates are available.
- [x] Share OpenAIP, SIGMET, airport weather, and NOTAM area layers with Navlog.
- [x] Verify the local build, tests, and desktop and mobile browser flows.
- [ ] Deploy and verify the Map tile and OpenAIP tiles in production.

## 2. Editable Navlog and Fuel Monitoring

- [x] Add waypoint search and notes, editable estimated and actual crossing times (ETO and ATO), and actual fuel remaining at each waypoint.
- [x] Validate UTC times and fuel values. Use the dispatch fuel unit and keep entries tied to the specific dispatch and waypoint.
- [x] Add a fuel-check reminder and link each fuel check back to the corresponding Navlog entry.
- [x] Enable the Fuel Monitoring tile. Show planned versus actual fuel, deviations, the latest fuel check, and estimated fuel at destination once enough data is available.
- [x] Verify that entries survive a reload and that a newly imported dispatch opens with its own entries.

## 3. OFP and dispatch release

- [x] Add tabs for briefing text, dispatch release, flight plan, NOTAMs, and weather alongside the existing IJV PDF export.
- [x] Add fields for actual weights, ramp fuel, takeoff speeds, and pilot sign-off.
- [x] Share actual takeoff fuel with Fuel Monitoring when the crew has entered the required values.

## 4. Diversion

- [x] Confirm sources for airport and runway dimensions, approach availability, airport weather, simulator position, and fuel on board.
- [x] Enable the Diversion tile. Show candidate airports on the OpenAIP map and rank them using runway suitability, weather, distance, and estimated fuel on landing.
- [x] Show the basis for the ranking and label any fallback position or fuel estimate explicitly.

## Later candidates

- [ ] Electronic loadsheet, including its link to OFP actual weights.
- [ ] Vertical flight profile on the Map using Navlog altitude and distance.
