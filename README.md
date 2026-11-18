# S/V Sefi — Free $0 Auto-Updating Tracker (GitHub Actions + GitHub Pages)

## 10-Second Setup
1. Create a **Public** repository on [GitHub](https://github.com/new) (public repos get unlimited free GitHub Actions minutes and free GitHub Pages hosting).
2. Upload all files from this folder (preserving `.github/workflows/update-sefi.yml`, `scripts/fetch_garmin.py`, `data/position.json`, and `index.html`).
3. Go to **Settings -> Pages -> Build and deployment -> Source**, choose **Deploy from a branch** (`main` / `/ (root)`), and save.
4. Go to **Actions -> Update Sefi Position Every 20 Min -> Run workflow** once to test immediately.

Your site will now auto-update every ~20 minutes from Garmin MapShare (`josefavrunin`) and pull live Open-Meteo weather whenever you open your GitHub Pages URL.
