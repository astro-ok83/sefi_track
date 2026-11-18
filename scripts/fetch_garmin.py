import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

KML_URL = "https://share.garmin.com/Feed/Share/josefavrunin"
OUT_PATH = os.path.join("data", "position.json")


def parse_speed_kts(raw: str, default: float = 0.0) -> float:
    m = re.search(r"([0-9]+(?:\.[0-9]+)?)", raw or "")
    if not m:
        return default
    val = float(m.group(1))
    low = (raw or "").lower()
    if "km/h" in low or "kph" in low:
        return round(val * 0.539957, 2)
    if "mph" in low:
        return round(val * 0.868976, 2)
    return round(val, 2)


def main() -> None:
    req = urllib.request.Request(
        KML_URL,
        headers={"User-Agent": "SefiTracker/1.0 (+https://github.com)"},
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        kml_bytes = resp.read()

    root = ET.fromstring(kml_bytes)
    ns = {"kml": "http://www.opengis.net/kml/2.2"}
    placemarks = root.findall(".//kml:Placemark", ns)
    if not placemarks:
        placemarks = root.findall(".//Placemark")

    if not placemarks:
        print("No Placemark found in Garmin KML feed; keeping existing position.json.")
        return

    latest = placemarks[-1]
    coords_el = latest.find(".//kml:coordinates", ns) or latest.find(".//coordinates")
    if coords_el is None or not (coords_el.text or "").strip():
        print("No coordinates found in latest Placemark; skipping update.")
        return

    parts = [p.strip() for p in coords_el.text.strip().split(",")]
    lon = float(parts[0])
    lat = float(parts[1])
    elev_m = float(parts[2]) if len(parts) > 2 else 0.0
    elev_ft = round(elev_m * 3.28084, 2)

    ext = {}
    for data_el in latest.findall(".//kml:Data", ns) + latest.findall(".//Data"):
        name = data_el.attrib.get("name", "")
        val_el = data_el.find("kml:value", ns) or data_el.find("value")
        if name and val_el is not None and val_el.text is not None:
            ext[name] = val_el.text.strip()

    ts_el = latest.find(".//kml:TimeStamp/kml:when", ns) or latest.find(".//TimeStamp/when")
    iso_time = ts_el.text.strip() if ts_el is not None and ts_el.text else datetime.now(timezone.utc).isoformat()

    speed_kts = parse_speed_kts(ext.get("Velocity", ""), 0.0)
    course = ext.get("Course", "SSW").split()[0] if ext.get("Course") else "SSW"
    text_msg = ext.get("Text", "").strip()

    payload = {
        "boat": "S/V Sefi",
        "tracker": ext.get("Name", "josef avrunin"),
        "mmsi": "261006251",
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "speedKts": speed_kts,
        "course": course,
        "elevationFt": elev_ft,
        "battery": "Normal",
        "messages": 1 if text_msg else 0,
        "lastMessage": text_msg,
        "timestamp": iso_time,
        "displayTime": ext.get("Time UTC", iso_time),
        "status": "ALL GOOD",
        "source": "Garmin MapShare KML",
        "checkedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"Updated {OUT_PATH}: {lat:.6f}, {lon:.6f} @ {iso_time}")


if __name__ == "__main__":
    main()
