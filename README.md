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
