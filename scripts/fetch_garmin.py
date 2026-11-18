"""Fetch the latest S/V Sefi position from Garmin MapShare and write data/*.json.

Runs from GitHub Actions every ~5 minutes. Never invents data: if the feed
fails, the old position is kept and 'feedError' is set so the site can show it.
"""
import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

MAPSHARE_ID = "josefavrunin"
FEED_URL = "https://share.garmin.com/Feed/Share/" + MAPSHARE_ID
POS_PATH = os.path.join("data", "position.json")
TRACK_PATH = os.path.join("data", "track.json")
HISTORY_DAYS = 7          # how much history to ask Garmin for on each run
MAX_TRACK_POINTS = 3000

KML = "{http://www.opengis.net/kml/2.2}"
COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def load_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def find(el, tag):
    """Namespace-tolerant find. Uses explicit None checks: an XML element with
    no children is falsy, so `a.find(x) or a.find(y)` silently returns None."""
    hit = el.find(".//" + KML + tag)
    if hit is None:
        hit = el.find(".//" + tag)
    return hit


def findall(el, tag):
    return el.findall(".//" + KML + tag) + el.findall(".//" + tag)


def first_number(raw):
    m = re.search(r"-?[0-9]+(?:\.[0-9]+)?", raw or "")
    return float(m.group(0)) if m else None


def speed_kts(raw):
    val = first_number(raw)
    if val is None:
        return None
    low = (raw or "").lower()
    if "km/h" in low or "kph" in low:
        val *= 0.539957
    elif "mph" in low:
        val *= 0.868976
    return round(val, 1)


def course(raw):
    deg = first_number(raw)
    if deg is None:
        return None, None
    return round(deg), COMPASS[int((deg % 360) / 22.5 + 0.5) % 16]


def is_true(raw):
    return (raw or "").strip().lower() in ("true", "yes", "1")


def parse_points(kml_bytes):
    root = ET.fromstring(kml_bytes)
    points = []
    for pm in findall(root, "Placemark"):
        point = find(pm, "Point")          # skip the LineString track placemark
        if point is None:
            continue
        coords = find(point, "coordinates")
        when = find(pm, "when")
        if coords is None or not (coords.text or "").strip() or when is None:
            continue
        parts = coords.text.strip().split(",")
        ext = {}
        for d in findall(pm, "Data"):
            v = find(d, "value")
            if d.get("name") and v is not None and v.text is not None:
                ext[d.get("name")] = v.text.strip()
        deg, compass = course(ext.get("Course"))
        points.append({
            "lat": round(float(parts[1]), 6),
            "lon": round(float(parts[0]), 6),
            "timestamp": when.text.strip(),
            "speedKts": speed_kts(ext.get("Velocity")),
            "courseDeg": deg,
            "course": compass,
            "emergency": is_true(ext.get("In Emergency")),
            "validFix": ext.get("Valid GPS Fix", "True").lower() != "false",
            "event": ext.get("Event", ""),
            "text": ext.get("Text", ""),
        })
    points.sort(key=lambda p: p["timestamp"])
    return points


def main() -> None:
    position = load_json(POS_PATH, {})
    track = load_json(TRACK_PATH, [])
    position["checkedAt"] = iso(now_utc())

    d1 = (now_utc() - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%dT%H:%MZ")
    url = f"{FEED_URL}?d1={d1}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SefiTracker/2.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            points = parse_points(resp.read())
    except Exception as e:  # network error, bad XML, password-protected feed...
        position["feedError"] = f"{type(e).__name__}: {e}"[:200]
        save_json(POS_PATH, position)
        print("Feed error, kept previous position:", position["feedError"])
        return

    position.pop("feedError", None)
    good = [p for p in points if p["validFix"]]
    if not good:
        save_json(POS_PATH, position)
        print(f"Feed returned no valid positions in the last {HISTORY_DAYS} days.")
        return

    latest = good[-1]
    last_msg = next((p for p in reversed(points) if p["text"]), None)
    position.update({
        "boat": "S/V Sefi",
        "mmsi": "261006251",
        "lat": latest["lat"],
        "lon": latest["lon"],
        "speedKts": latest["speedKts"],
        "courseDeg": latest["courseDeg"],
        "course": latest["course"],
        "timestamp": latest["timestamp"],
        "emergency": any(p["emergency"] for p in points[-3:]),
        "lastMessage": last_msg["text"] if last_msg else "",
        "lastMessageTime": last_msg["timestamp"] if last_msg else "",
        "source": "Garmin MapShare",
    })
    for stale_key in ("status", "battery", "messages", "displayTime", "elevationFt", "tracker"):
        position.pop(stale_key, None)   # old hard-coded fields

    seen = {p["t"] for p in track}
    for p in good:
        if p["timestamp"] not in seen:
            track.append({"lat": p["lat"], "lon": p["lon"], "t": p["timestamp"]})
    track.sort(key=lambda p: p["t"])
    track = track[-MAX_TRACK_POINTS:]

    save_json(POS_PATH, position)
    save_json(TRACK_PATH, track)
    print(f"Latest fix {latest['lat']}, {latest['lon']} at {latest['timestamp']}; "
          f"{len(good)} points in feed, {len(track)} in track.")


if __name__ == "__main__":
    main()
