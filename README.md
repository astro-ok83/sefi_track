# S/V Sefi — Auto-Updating Tracker (GitHub Actions + GitHub Pages)

Every ~20 min a GitHub Action reads Garmin MapShare (`josefavrunin`), writes
`data/position.json` and `data/track.json`, and commits them. GitHub Pages then
serves the updated site. The open page re-checks every 5 minutes.

## Setup
1. Repo must be **Public**.
2. The workflow lives at `.github/workflows/update-sefi.yml`. **Drag-and-drop upload in the
   GitHub website skips folders starting with a dot**, so create it with
   *Add file → Create new file*, type the full path `.github/workflows/update-sefi.yml`
   as the name, and paste the contents.
3. **Settings → Pages → Deploy from a branch → `main` / `(root)`** → Save.
4. **Actions** tab → enable workflows if asked → *Update Sefi Position Every 20 Min* → **Run workflow**.

## Status shown on the site
- **TRACKING · NO SOS** — fresh Garmin fix, no emergency flag.
- **NO FIX FOR X H** — no new Garmin point for over 4 h (tracker off, battery, or just a long interval).
- **SOS ACTIVE** — the inReach reports emergency mode.

## Weather & storm warnings
`scripts/fetch_weather.py` runs after the position update (at most hourly, or sooner if Sefi
moved > 30 nm) and writes `data/weather.json`:
- **Open-Meteo** wind, gusts, waves, swell, pressure and CAPE at the boat and 6–72 h ahead on her course.
- **NHC** active Atlantic tropical cyclones (distance to boat and projected route), the Tropical
  Weather Outlook formation chances, and High Seas Forecast gale/storm/hurricane warnings.

`level` is `OK`, `CAUTION` or `WARNING`; `alerts[]` lists the reasons; `headline` is a one-line summary.
Thresholds: wind ≥ 25 kt (caution) / 34 kt gale (warning), gusts ≥ 35/45 kt, waves ≥ 3.5/5 m,
tropical cyclone within 600/300 nm of the boat or route. Beyond 24 h, alerts are capped at CAUTION.
The site shows these in a banner; the 2-hourly status notification reads the same file.

## Destination
`data/destinations.json` holds the current destination and the previous ones:
```json
{ "current": { "name": "...", "lat": 14.465, "lon": -60.87, "setAt": "..." },
  "history": [ { "name": "...", "lat": ..., "lon": ..., "arrivedAt": "...", "leftAt": "...", "reached": true } ] }
```
The site draws the route as a dashed great-circle line, the destination as a red pin, previous
destinations as anchors, a progress bar from the last reached stop, and a distance/time calculator.

## Points of interest and icons
`data/places.json` holds map icons, the default route mode and points of interest:
```json
{ "icons": { "boat": { "kind": "arrow", "color": "#10b981" }, "destination": { "kind": "pin", "color": "#ef4444" }, ... },
  "routeMode": "via",
  "pois": [ { "id": "...", "type": "stop|marina|note|hazard", "name": "...", "lat": ..., "lon": ...,
              "note": "...", "adminOnly": false, "done": false, "icon": { "kind": "emoji", "emoji": "⛵" } } ] }
```
- **Planned stops** (in array order) shape the route: *Via stops* draws Sefi → stops → destination;
  *Direct* draws Sefi → destination and every point shows its distance from Sefi. Visitors can switch
  with the Route toggle above the map; the default is set on the admin page.
- Stops marked `done` are left out of the route. `adminOnly` points only show on the admin page
  (the file itself is still public).
- Icon kinds: arrow, boat, pin, anchor, flag, marina, star, dot, warning, note, or `emoji`.
  Visitors can hide each type with the chips above the map.

## Admin page (`admin.html`, linked at the bottom of the site)
Unlock with the PIN (top right). The PIN decrypts a GitHub token stored encrypted in `data/auth.json`
(AES-GCM, PBKDF2 600k); the token stays in memory only, and every save is a commit through the GitHub API.
- **Destination:** search → results appear as numbered pins on the map and in a list (region, type,
  distance from Sefi; marinas/harbours first, then nearest to the map view). Tap one, or tap the map,
  then drag the red pin to fine-tune. A purple preview line shows the route, distance and ETA before
  you press *Accept & save*. The old destination moves to the list.
- **Destinations list:** rename, move, re-date, mark reached/not reached, reorder or delete entries.
- **Points:** add stops, marinas, notes and hazards with the same location picker; *Drop pin* starts a
  note at the spot you tap. Stops can be reordered.
- **Icons:** pick a built-in symbol + colour, or any emoji, for the boat, destination, previous
  moorings and each point type.
- **Settings:** default route mode; set up or change the PIN.

Search uses OpenStreetMap data through the free Photon and Nominatim services (no key).

**One-time setup:** create a fine-grained token at GitHub → Settings → Developer settings →
Fine-grained tokens: *Only select repositories* = `sefi_track`, *Repository permissions → Contents* =
Read and write. On the admin page: *Settings → Set up / change PIN*, paste the token, pick a PIN.
Use 12+ characters: `data/auth.json` is public, so a short PIN can be guessed offline.
Re-run setup to change the PIN or when the token expires.
