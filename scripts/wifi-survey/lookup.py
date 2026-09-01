"""採取したBSSIDが Apple / Google の測位データベースに載っているかを調べる。

    uv run --with gsloc python scripts/wifi-survey/lookup.py tmp/wifi-survey/scan-20260902.jsonl

答えたい問いは2つある。

1. **載っているか** — 載っていなければ、その場所でWiFi測位は何もしてくれない。
   Apple は BSSID 単位で引ける。見つからない場合の返り値は緯度経度が
   -180.0、accuracy が -1 という番兵で、正常な座標と区別がつく（実測で確認）。

2. **載っていて、どれだけ効くか** — Google の Geolocation API は観測した
   AP群をまとめて投げると、実際に端末が受け取るのと同じ推定座標と精度半径を
   返す。`considerIp: false` を必ず付ける。付けないとWiFiで測位できなくても
   IPアドレスから位置を返してしまい、「効いている」と誤読する。

Apple のDBに載っていることは必要条件であって十分条件ではない。載っていても、
記録されている座標自体が通りすがりの端末の観測から推定されたものなので、
キャンパスから離れた位置が登録されていることがある。だから見つかったAPは
キャンパス原点からの距離も出す。
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path

GOOGLE_ENDPOINT = "https://www.googleapis.com/geolocation/v1/geolocate"
# Apple が「知らない」ときに返す番兵。座標として有効な値ではない。
APPLE_UNKNOWN_LAT = -180.0
REPO_ROOT = Path(__file__).resolve().parents[2]
COORDINATES = REPO_ROOT / "src" / "lib" / "map" / "toyosu-campus.coordinates.json"


def campus_origin() -> tuple[float, float] | None:
    """キャンパス原点。無ければ None。

    これはマップ側の成果物で、ここが唯一の依存。無いブランチでも
    「載っているか」「地点を区別できるか」という本題は全部出せるので、
    落とすのは原点からの距離という診断だけにする。
    """
    if not COORDINATES.exists():
        return None
    data = json.loads(COORDINATES.read_text(encoding="utf-8"))
    return data["origin"]["lat"], data["origin"]["lon"]


def metres_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """小領域なので等距円筒近似で足りる。"""
    radius = 6378137.0
    lat_mean = math.radians((a[0] + b[0]) / 2)
    north = math.radians(b[0] - a[0]) * radius
    east = math.radians(b[1] - a[1]) * radius * math.cos(lat_mean)
    return math.hypot(east, north)


def median(values: list[float]) -> float:
    if not values:
        return float("nan")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def load_scans(path: Path) -> dict[str, dict[str, list[float]]]:
    """label -> bssid -> 観測したdBmのリスト。"""
    by_label: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            print(f"warning: {path.name}:{line_number} を読み飛ばしました ({error})", file=sys.stderr)
            continue
        for network in record.get("networks") or []:
            bssid = (network.get("bssid") or "").lower()
            if not bssid:
                continue
            dbm = network.get("dbm")
            by_label[record["label"]][bssid].append(float(dbm) if dbm is not None else -75.0)
    return by_label


def query_apple(bssids: list[str]) -> dict[str, dict]:
    try:
        from gsloc.core import query
    except ImportError:
        print(
            "gsloc が入っていません。`uv run --with gsloc python scripts/wifi-survey/lookup.py ...` で実行してください。",
            file=sys.stderr,
        )
        return {}

    found: dict[str, dict] = {}
    # 一度に投げすぎると返らないことがあるので小分けにする。
    for start in range(0, len(bssids), 25):
        chunk = bssids[start : start + 25]
        try:
            results = query(chunk)
        except Exception as error:  # 非公式エンドポイントなので何が来るか保証がない
            print(f"warning: Apple への問い合わせが失敗しました ({error})", file=sys.stderr)
            continue
        for info in results:
            known = info.latitude != APPLE_UNKNOWN_LAT and info.accuracy is not None and info.accuracy >= 0
            found[info.mac.lower()] = {
                "known": known,
                "lat": info.latitude if known else None,
                "lon": info.longitude if known else None,
                "accuracy": info.accuracy if known else None,
            }
    return found


def query_google(key: str, access_points: list[dict]) -> dict:
    body = json.dumps(
        {
            "considerIp": False,
            "wifiAccessPoints": [
                {"macAddress": ap["bssid"], "signalStrength": ap["dbm"]} for ap in access_points
            ],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{GOOGLE_ENDPOINT}?key={key}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read())
        return {
            "located": True,
            "lat": payload["location"]["lat"],
            "lon": payload["location"]["lng"],
            "accuracy": payload["accuracy"],
        }
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:200]
        # 404 / notFound は「このAP群では測位できない」という明確な答え。
        return {"located": False, "status": error.code, "detail": detail}
    except Exception as error:
        return {"located": False, "status": None, "detail": str(error)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("scan", type=Path, help="scan.ps1 が書いた JSONL")
    parser.add_argument("--out", type=Path, help="結果JSONの書き出し先")
    parser.add_argument(
        "--google-key",
        default=os.environ.get("GOOGLE_GEOLOCATION_API_KEY"),
        help="Google Geolocation API キー（既定は環境変数 GOOGLE_GEOLOCATION_API_KEY）",
    )
    parser.add_argument("--skip-apple", action="store_true")
    args = parser.parse_args()

    by_label = load_scans(args.scan)
    if not by_label:
        print("スキャン記録が空です。", file=sys.stderr)
        return 1

    all_bssids = sorted({bssid for label in by_label.values() for bssid in label})
    print(f"{len(by_label)} 地点 / のべ {len(all_bssids)} BSSID\n")

    apple = {} if args.skip_apple else query_apple(all_bssids)
    origin = campus_origin()

    if apple:
        known = [entry for entry in apple.values() if entry["known"]]
        print(f"== Apple ==\n  登録あり {len(known)} / {len(apple)} BSSID")
        if known and origin:
            distances = [metres_between(origin, (entry["lat"], entry["lon"])) for entry in known]
            far = sum(1 for distance in distances if distance > 300)
            print(f"  原点からの距離 中央値 {median(distances):.0f} m / 300m超 {far} 件")
            if far:
                print("  ※ 遠くに登録されているAPは、載っていても測位を狂わせます")
        elif known:
            print(f"  （{COORDINATES.name} が無いので、登録座標の距離診断は省略しました）")
        print()

    results = []
    for label, networks in by_label.items():
        access_points = [
            {"bssid": bssid, "dbm": median(samples)} for bssid, samples in networks.items()
        ]
        access_points.sort(key=lambda ap: ap["dbm"], reverse=True)
        apple_known = sum(1 for ap in access_points if apple.get(ap["bssid"], {}).get("known"))

        entry = {
            "label": label,
            "accessPoints": len(access_points),
            "appleKnown": apple_known,
            "google": None,
        }

        line = f"{label}\n  AP {len(access_points)} 件"
        if apple:
            line += f" / Apple登録 {apple_known} 件"
        if args.google_key and len(access_points) >= 2:
            google = query_google(args.google_key, access_points[:20])
            entry["google"] = google
            if google["located"]:
                line += (
                    f"\n  Google: {google['lat']:.6f}, {google['lon']:.6f}"
                    f" / 精度半径 {google['accuracy']:.0f} m"
                )
                if origin:
                    distance = metres_between(origin, (google["lat"], google["lon"]))
                    line += f" / 原点から {distance:.0f} m"
            else:
                line += f"\n  Google: 測位不能 (HTTP {google['status']})"
        elif args.google_key:
            line += "\n  Google: APが2件未満なので問い合わせません（仕様上2件以上必要）"
        print(line + "\n")
        results.append(entry)

    located = [entry for entry in results if entry["google"] and entry["google"]["located"]]
    if len(located) >= 2:
        print("== 地点間の距離（Googleの推定どうし）==")
        print("  教室の間隔より小さく出ないなら、教室は区別できません。\n")
        for i in range(len(located)):
            for j in range(i + 1, len(located)):
                a, b = located[i], located[j]
                gap = metres_between(
                    (a["google"]["lat"], a["google"]["lon"]), (b["google"]["lat"], b["google"]["lon"])
                )
                print(f"  {gap:6.1f} m  {a['label']} ↔ {b['label']}")
        print()

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(
            json.dumps({"apple": apple, "labels": results}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"→ {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
