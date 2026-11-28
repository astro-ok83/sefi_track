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
The site draws a dashed great-circle line from Sefi to the destination, previous destinations as grey
dots, a progress bar from the last reached stop, and a distance/time calculator (editable speed).

**Changing it (PIN):** *Change destination* on the site → start typing a place (suggestions from
OpenStreetMap via the free Photon search, biased toward Sefi's position) or tap/drag the pin on the
small map, or type lat/lon → PIN.
The PIN decrypts a GitHub token stored encrypted in `data/auth.json` (AES-GCM, PBKDF2 600k), and the
page commits the new `destinations.json`; the old destination moves to the history.

**One-time setup:** create a fine-grained token at GitHub → Settings → Developer settings →
Fine-grained tokens: *Only select repositories* = `sefi_track`, *Repository permissions → Contents* =
Read and write. On the site: *Change destination → Set up / change PIN*, paste the token, pick a 6+
digit PIN. Re-run setup to change the PIN or when the token expires. A longer PIN is harder to guess.
