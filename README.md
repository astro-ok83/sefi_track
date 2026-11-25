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
