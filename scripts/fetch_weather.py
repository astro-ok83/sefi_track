"""Weather + storm-warning check around S/V Sefi. Writes data/weather.json.

Runs from GitHub Actions right after fetch_garmin.py. Sources (all free, no API key):
  * Open-Meteo forecast + marine API: wind, gusts, waves, swell, pressure, CAPE at the boat
    and at points 6-72 h ahead along her current course (same projection as the website).
  * NHC CurrentStorms.json: active Atlantic tropical cyclones, with distance to the boat/route.
  * NHC Atlantic Tropical Weather Outlook: disturbances that may form (formation chances).
  * NWS/NHC High Seas Forecast (Tropical Atlantic, 7-31N west of 35W): GALE/STORM/HURRICANE
    warnings in force.

Never invents data: each source that fails is listed in "errors" and simply contributes no alert.
To keep commits down it only refreshes once an hour, or sooner if the boat has moved > 30 nm.
"""
import json
import math
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

POS_PATH = os.path.join("data", "position.json")
TRACK_PATH = os.path.join("data", "track.json")
WX_PATH = os.path.join("data", "weather.json")

REFRESH_MIN = 55          # minimum minutes between refreshes...
REFRESH_MOVE_NM = 30      # ...unless the boat has moved this far since the last one
AHEAD_HOURS = [0, 6, 12, 18, 24, 36, 48, 60, 72]
UA = {"User-Agent": "SefiTracker/2.0 (github.com/astro-ok83/sefi_track)"}

# Alert thresholds: (caution, warning). Match the notification task's "WORRY" rules.
WIND_KTS = (25, 34)       # sustained; 34 kt = gale
GUST_KTS = (35, 45)
WAVE_M = (3.5, 5.0)
CAPE = 1500               # J/kg - squall / thunderstorm potential (caution only)
STORM_NM = (600, 300)     # tropical cyclone within this distance of boat or route

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
MARINE = "https://marine-api.open-meteo.com/v1/marine"
NHC_STORMS = "https://www.nhc.noaa.gov/CurrentStorms.json"
NHC_TWO = "https://www.nhc.noaa.gov/xml/TWOAT.xml"
HIGH_SEAS = "https://tgftp.nws.noaa.gov/data/raw/fz/fznt02.knhc.hsf.at2.txt"

COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
R_NM = 3440.065
RANK = {"OK": 0, "CAUTION": 1, "WARNING": 2}


# ---------- helpers ----------
def now_utc():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def get(url, as_json=True, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return json.loads(raw) if as_json else raw.decode("utf-8", "replace")


def err(e):
    return f"{type(e).__name__}: {e}"[:200]


def compass(deg):
    return None if deg is None else COMPASS[int((deg % 360) / 22.5 + 0.5) % 16]


def haversine_nm(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_NM * math.asin(min(1.0, math.sqrt(h)))


def destination(start, bearing_deg, dist_nm):
    d, b = dist_nm / R_NM, math.radians(bearing_deg)
    la1, lo1 = math.radians(start[0]), math.radians(start[1])
    la2 = math.asin(math.sin(la1) * math.cos(d) + math.cos(la1) * math.sin(d) * math.cos(b))
    lo2 = lo1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(la1), math.cos(d) - math.sin(la1) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def avg_speed_24h(track):
    pts = sorted(((parse_iso(p.get("t")), (p["lat"], p["lon"])) for p in track
                  if isinstance(p, dict) and "lat" in p and "lon" in p and parse_iso(p.get("t"))),
                 key=lambda x: x[0])
    if len(pts) < 2:
        return None
    end = pts[-1][0]
    recent = [p for p in pts if p[0] >= end - timedelta(hours=24)]
    hours = (end - recent[0][0]).total_seconds() / 3600 if len(recent) > 1 else 0
    if hours < 1:
        return None
    nm = sum(haversine_nm(recent[i - 1][1], recent[i][1]) for i in range(1, len(recent)))
    return nm / hours


def level_for(value, limits):
    if value is None:
        return "OK"
    return "WARNING" if value >= limits[1] else "CAUTION" if value >= limits[0] else "OK"


def coord(s, numeric=None):
    """NHC gives '20.1N' / '66.5W' (and sometimes numeric fields)."""
    if isinstance(numeric, (int, float)):
        return float(numeric)
    m = re.match(r"\s*(-?[0-9.]+)\s*([NSEW])?", str(s or ""))
    if not m:
        return None
    v = float(m.group(1))
    return -v if m.group(2) in ("S", "W") else v


# ---------- sources ----------
def fetch_model(points):
    """Open-Meteo for every point in one request per API. Returns per-point dicts at each point's hour."""
    lats = ",".join(f"{p['lat']:.3f}" for p in points)
    lons = ",".join(f"{p['lon']:.3f}" for p in points)
    atmo = get(f"{OPEN_METEO}?latitude={lats}&longitude={lons}"
               "&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,pressure_msl,precipitation,cape,temperature_2m"
               "&wind_speed_unit=kn&forecast_days=5&timezone=GMT")
    try:
        sea = get(f"{MARINE}?latitude={lats}&longitude={lons}"
                  "&hourly=wave_height,wave_period,wave_direction,swell_wave_height&forecast_days=5&timezone=GMT")
    except Exception as e:      # waves are nice-to-have; wind is the main thing
        sea, sea_err = None, err(e)
    else:
        sea_err = None
    atmo = atmo if isinstance(atmo, list) else [atmo]
    sea = sea if isinstance(sea, list) else ([sea] if sea else [None] * len(points))

    def at(series, when, key):
        hourly = (series or {}).get("hourly") or {}
        times, vals = hourly.get("time"), hourly.get(key)
        if not times or not vals:
            return None
        t0 = datetime.fromisoformat(times[0]).replace(tzinfo=timezone.utc)
        i = round((when - t0).total_seconds() / 3600)
        return vals[i] if 0 <= i < len(vals) else None

    out = []
    for i, p in enumerate(points):
        a = atmo[i] if i < len(atmo) else None
        s = sea[i] if i < len(sea) else None
        w = p["when"]
        r = lambda v, n=0: None if v is None else round(v, n) if n else round(v)
        wd = at(a, w, "wind_direction_10m")
        out.append({
            "h": p["h"], "time": iso(w), "lat": round(p["lat"], 3), "lon": round(p["lon"], 3),
            "distNm": round(p["dist"]),
            "windKts": r(at(a, w, "wind_speed_10m")),
            "gustKts": r(at(a, w, "wind_gusts_10m")),
            "windFromDeg": r(wd), "windFrom": compass(wd),
            "pressureHpa": r(at(a, w, "pressure_msl")),
            "precipMm": r(at(a, w, "precipitation"), 1),
            "cape": r(at(a, w, "cape")),
            "tempC": r(at(a, w, "temperature_2m")),
            "waveM": r(at(s, w, "wave_height"), 1),
            "wavePeriodS": r(at(s, w, "wave_period")),
            "swellM": r(at(s, w, "swell_wave_height"), 1),
        })
    return out, sea_err


def fetch_storms(boat, route):
    data = get(NHC_STORMS)
    storms = []
    for s in data.get("activeStorms") or []:
        lat = coord(s.get("latitude"), s.get("latitudeNumeric"))
        lon = coord(s.get("longitude"), s.get("longitudeNumeric"))
        if lat is None or lon is None:
            continue
        sid = str(s.get("id", "")).lower()
        if sid and not sid.startswith("al"):        # Atlantic basin only
            continue
        storm = {
            "name": s.get("name"), "classification": s.get("classification"),
            "intensityKts": coord(s.get("intensity")), "pressureMb": coord(s.get("pressure")),
            "lat": lat, "lon": lon,
            "movement": f"{s.get('movementDir', '')}° at {s.get('movementSpeed', '')} mph".strip(),
            "lastUpdate": s.get("lastUpdate"),
            "distNm": round(haversine_nm(boat, (lat, lon))),
            "minRouteDistNm": round(min(haversine_nm((p["lat"], p["lon"]), (lat, lon)) for p in route)),
        }
        storms.append(storm)
    storms.sort(key=lambda s: s["minRouteDistNm"])
    return storms


def fetch_outlook():
    """Atlantic Tropical Weather Outlook text + any formation chances it mentions."""
    root = ET.fromstring(get(NHC_TWO, as_json=False).encode("utf-8"))
    item = root.find(".//item")
    if item is None:
        return {"text": "", "issued": None, "disturbances": []}
    desc = re.sub(r"<[^>]+>", " ", item.findtext("description") or "")
    desc = re.sub(r"\s+", " ", desc).strip()
    chances = []
    for m in re.finditer(r"Formation chance through (48 hours|7 days)\.*\s*(low|medium|high)[^0-9]*([0-9]+) percent",
                         desc, re.I):
        chances.append({"window": m.group(1), "level": m.group(2).lower(), "percent": int(m.group(3))})
    return {"issued": item.findtext("pubDate"), "text": desc[:1200], "formationChances": chances}


def fetch_high_seas():
    """Warnings section of the NHC High Seas Forecast (Tropical Atlantic, 7-31N west of 35W)."""
    txt = get(HIGH_SEAS, as_json=False)
    warnings = []
    for m in re.finditer(r"\.\.\.(GALE|STORM|HURRICANE FORCE WIND|HURRICANE|TROPICAL STORM) WARNING\.\.\.(.*?)(?=\n\s*\n|\.\.\.[A-Z ]+WARNING\.\.\.)",
                         txt, re.S):
        body = re.sub(r"\s+", " ", m.group(2)).strip()
        warnings.append({"type": m.group(1).title() + " Warning", "text": body[:400]})
    issued = re.search(r"^\d{3,4} [AP]M \w{3} \w{3} \w{3} \d{1,2} \d{4}|^\d{4} UTC \w{3} \w{3} \d{1,2} \d{4}", txt, re.M)
    return {"issued": issued.group(0) if issued else None, "warnings": warnings,
            "coverage": "Tropical Atlantic 07N-31N, 35W to the Caribbean"}


# ---------- main ----------
def main():
    pos = load_json(POS_PATH, {})
    track = load_json(TRACK_PATH, [])
    old = load_json(WX_PATH, {})
    if pos.get("lat") is None or pos.get("lon") is None:
        print("No position yet; skipping weather.")
        return
    boat = (pos["lat"], pos["lon"])

    last = parse_iso(old.get("fetchedAt"))
    moved = haversine_nm(boat, (old["boat"]["lat"], old["boat"]["lon"])) if old.get("boat") else 1e9
    if last and now_utc() - last < timedelta(minutes=REFRESH_MIN) and moved < REFRESH_MOVE_NM:
        print(f"Weather is {int((now_utc() - last).total_seconds() // 60)} min old, boat moved {moved:.0f} nm; skipping.")
        return

    course = pos.get("courseDeg")
    speed = avg_speed_24h(track) or 0
    now_speed = pos.get("speedKts") or 0
    if now_speed > 1.5 and speed < 0.6 * now_speed:   # just left port: 24 h average still counts the berth
        speed = now_speed
    hour0 = now_utc().replace(minute=0, second=0, microsecond=0)
    if course is None or speed < 0.5:      # no heading: just check the boat's own spot over time
        course, speed = 0, 0
    points = [{"h": h, "dist": speed * h, "when": hour0 + timedelta(hours=h),
               **dict(zip(("lat", "lon"), destination(boat, course, speed * h)))} for h in AHEAD_HOURS]

    wx = {
        "fetchedAt": iso(now_utc()),
        "boat": {"lat": boat[0], "lon": boat[1], "fix": pos.get("timestamp")},
        "projection": {"courseDeg": round(course), "speedKts": round(speed, 1),
                       "note": "straight line on current course at 24 h average speed"},
        "thresholds": {"windKts": WIND_KTS, "gustKts": GUST_KTS, "waveM": WAVE_M, "cape": CAPE, "stormNm": STORM_NM},
        "alerts": [], "errors": {},
    }
    alerts = wx["alerts"]

    def add(level, kind, msg):
        if level != "OK":
            alerts.append({"level": level, "type": kind, "message": msg})

    # 1) Model forecast at the boat and ahead
    try:
        ahead, sea_err = fetch_model(points)
        if sea_err:
            wx["errors"]["marine"] = sea_err
        wx["now"], wx["ahead"] = ahead[0], ahead
        for span, label in ((24, "next 24 h"), (72, "24-72 h")):
            rows = [r for r in ahead if (r["h"] <= 24 if span == 24 else r["h"] > 24)]
            def peak(k):
                vals = [(r[k], r) for r in rows if r[k] is not None]
                return max(vals, key=lambda x: x[0]) if vals else (None, None)
            w, wr = peak("windKts")
            g, gr = peak("gustKts")
            wv, wvr = peak("waveM")
            c, cr = peak("cape")
            wx["max24h" if span == 24 else "max24to72h"] = {"windKts": w, "gustKts": g, "waveM": wv, "cape": c}
            # Alerts beyond 24 h are downgraded one step - model skill drops and she may change course.
            def lvl(l):
                return l if span == 24 or l == "OK" else "CAUTION"
            add(lvl(level_for(w, WIND_KTS)), "wind", f"Wind {w} kt from {wr['windFrom']} at +{wr['h']} h ({label})" if w else "")
            add(lvl(level_for(g, GUST_KTS)), "gusts", f"Gusts {g} kt at +{gr['h']} h ({label})" if g else "")
            add(lvl(level_for(wv, WAVE_M)), "waves", f"Waves {wv} m at +{wvr['h']} h ({label})" if wv else "")
            if span == 24 and c is not None and c >= CAPE:
                add("CAUTION", "squalls", f"High CAPE {c} J/kg at +{cr['h']} h - squalls/thunderstorms possible")
        p0 = ahead[0]["pressureHpa"]
        p24 = next((r["pressureHpa"] for r in ahead if r["h"] == 24), None)
        if p0 and p24 and p0 - p24 >= 8:
            add("CAUTION", "pressure", f"Pressure falling {p0 - p24} hPa in 24 h along her course")
    except Exception as e:
        wx["errors"]["openMeteo"] = err(e)

    route = [{"lat": r["lat"], "lon": r["lon"]} for r in wx.get("ahead", [])] or \
            [{"lat": p["lat"], "lon": p["lon"]} for p in points]

    # 2) Active tropical cyclones
    try:
        storms = fetch_storms(boat, route)
        wx["tropical"] = {"activeStorms": storms, "source": "NHC CurrentStorms.json"}
        for s in storms:
            d = min(s["distNm"], s["minRouteDistNm"])
            lv = "WARNING" if d <= STORM_NM[1] else "CAUTION" if d <= STORM_NM[0] else "OK"
            add(lv, "tropical", f"{s['classification'] or ''} {s['name']} ({s['intensityKts']:.0f} kt) "
                                f"{s['distNm']} nm from Sefi, {s['minRouteDistNm']} nm from her projected route"
                if s["intensityKts"] is not None else
                f"{s['classification'] or ''} {s['name']} {s['distNm']} nm from Sefi")
    except Exception as e:
        wx["errors"]["nhcStorms"] = err(e)

    # 3) Tropical Weather Outlook (disturbances)
    try:
        two = fetch_outlook()
        wx.setdefault("tropical", {})["outlook"] = two
        hi = [c for c in two["formationChances"] if c["level"] in ("medium", "high")]
        if hi:
            add("CAUTION", "tropical", "NHC outlook has a disturbance with "
                + ", ".join(f"{c['level']} ({c['percent']}%) formation chance in {c['window']}" for c in hi)
                + " - check its location vs her route")
    except Exception as e:
        wx["errors"]["nhcOutlook"] = err(e)

    # 4) High Seas Forecast warnings (only covers west of 35W)
    try:
        hs = fetch_high_seas()
        wx["highSeas"] = hs
        for w in hs["warnings"]:
            # Area is given as corner points like "30N40W" / "31.5N 35W"; distance to the nearest one.
            pts = [(float(a), -float(b)) for a, b in re.findall(r"(\d{1,2}(?:\.\d)?)N\s?(\d{1,3}(?:\.\d)?)W", w["text"])]
            d = min((haversine_nm((r["lat"], r["lon"]), q) for q in pts for r in route), default=None)
            w["minRouteDistNm"] = None if d is None else round(d)
            if d is not None and d > STORM_NM[0]:
                continue                       # far from her - keep it in the file, no alert
            strong = "GALE" not in w["type"].upper()
            add("WARNING" if strong and (d is None or d <= STORM_NM[1]) else "CAUTION", "highSeas",
                f"NHC {w['type']}" + (f" ~{round(d)} nm from her route" if d is not None else "") + f": {w['text'][:160]}")
    except Exception as e:
        wx["errors"]["highSeas"] = err(e)

    alerts[:] = [a for a in alerts if a["message"]]
    alerts.sort(key=lambda a: -RANK[a["level"]])
    wx["level"] = alerts[0]["level"] if alerts else "OK"
    n = wx.get("now") or {}
    m = wx.get("max24h") or {}
    base = (f"Now {n.get('windKts', '?')} kt {n.get('windFrom') or ''}, gusts {n.get('gustKts', '?')}, "
            f"waves {n.get('waveM', '?')} m · 24 h max {m.get('windKts', '?')} kt / gusts {m.get('gustKts', '?')} / "
            f"{m.get('waveM', '?')} m") if n else "Model forecast unavailable"
    wx["headline"] = (f"{wx['level']}: {alerts[0]['message']}" if alerts else "OK: no storm or gale signals") + " | " + base
    save_json(WX_PATH, wx)
    print(wx["headline"])
    if wx["errors"]:
        print("Errors:", wx["errors"])


if __name__ == "__main__":
    main()
