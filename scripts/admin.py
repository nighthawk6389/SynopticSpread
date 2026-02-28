#!/usr/bin/env python3
"""CLI script for SynopticSpread admin operations.

Usage:
    uv run scripts/admin.py status
    uv run scripts/admin.py trigger GFS [--time 2026-02-25T18:00:00]
    uv run scripts/admin.py trigger NAM
    uv run scripts/admin.py trigger ECMWF
    uv run scripts/admin.py clear runs
    uv run scripts/admin.py clear metrics
    uv run scripts/admin.py clear snapshots
    uv run scripts/admin.py clear cache
    uv run scripts/admin.py reset
"""

import argparse
import json
import os
import sys

import httpx

BASE_URL = os.environ.get("SYNOPTIC_API_URL", "http://localhost:8000/api/admin")


def print_json(data: dict | list):
    print(json.dumps(data, indent=2))


def status():
    r = httpx.get(f"{BASE_URL}/status")
    r.raise_for_status()
    data = r.json()
    print(f"Runs:            {data['runs']}")
    print(f"Point metrics:   {data['point_metrics']}")
    print(f"Grid snapshots:  {data['grid_snapshots']}")
    print(f"Zarr files:      {data['zarr_files_on_disk']}")
    if data["recent_runs"]:
        print("\nRecent runs:")
        for run in data["recent_runs"]:
            fhrs = run.get("forecast_hours") or []
            print(
                f"  {run['model']:6s}  {run['init_time']}  status={run['status']}  fhrs={len(fhrs)}"
            )


def trigger(model: str, init_time: str | None):
    payload: dict = {"model": model}
    if init_time:
        payload["init_time"] = init_time
    r = httpx.post(f"{BASE_URL}/trigger", json=payload, timeout=60)
    r.raise_for_status()
    data = r.json()
    print(f"Queued: {data['model']} @ {data['init_time']}")
    print(f"Status:  {data['status']}")
    print(f"Message: {data['message']}")


def clear(resource: str):
    valid = {"runs", "metrics", "snapshots", "cache"}
    if resource not in valid:
        print(f"Unknown resource '{resource}'. Choose from: {', '.join(sorted(valid))}")
        sys.exit(1)
    r = httpx.delete(f"{BASE_URL}/{resource}", timeout=30)
    r.raise_for_status()
    print_json(r.json())


def reset():
    confirm = input("This will delete ALL runs, metrics, snapshots, zarr files, and cache. Continue? [y/N] ")
    if confirm.strip().lower() != "y":
        print("Aborted.")
        return
    r = httpx.delete(f"{BASE_URL}/reset", timeout=30)
    r.raise_for_status()
    print_json(r.json())


def main():
    parser = argparse.ArgumentParser(
        description="SynopticSpread admin CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status", help="Show DB and file counts")

    p_trigger = subparsers.add_parser("trigger", help="Queue model ingestion")
    p_trigger.add_argument(
        "model",
        choices=["GFS", "NAM", "ECMWF", "HRRR", "AIGFS", "RRFS"],
        help="Model name",
    )
    p_trigger.add_argument(
        "--time",
        dest="init_time",
        metavar="DATETIME",
        help="Init time ISO-8601, e.g. 2026-02-25T18:00:00 (defaults to latest cycle)",
    )

    p_clear = subparsers.add_parser("clear", help="Delete a category of records/files")
    p_clear.add_argument(
        "resource",
        choices=["runs", "metrics", "snapshots", "cache"],
        help="What to clear",
    )

    subparsers.add_parser("reset", help="Full reset: delete all DB records + zarr + cache")

    args = parser.parse_args()

    try:
        if args.command == "status":
            status()
        elif args.command == "trigger":
            trigger(args.model, args.init_time)
        elif args.command == "clear":
            clear(args.resource)
        elif args.command == "reset":
            reset()
    except httpx.HTTPStatusError as e:
        print(f"HTTP {e.response.status_code}: {e.response.text}", file=sys.stderr)
        sys.exit(1)
    except httpx.ConnectError:
        print(f"Could not connect to {BASE_URL}. Is the backend running?", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
