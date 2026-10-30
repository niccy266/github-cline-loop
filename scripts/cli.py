#!/usr/bin/env python3
import sys, os
from datetime import datetime, timezone, timedelta
from pathlib import Path

# New Zealand time zone: UTC+12 standard, UTC+13 with daylight savings
# DST starts last Sunday in September, ends first Sunday in April
_CUTOFF_SPRING = (9, 25)  # Approximate: after Sept 25 is DST
_CUTOFF_AUTUMN = (4, 25)  # Approximate: after Apr 25 is standard

def _is_nz_dst(dt):
    """Check if given UTC datetime is in NZ daylight savings."""
    month = dt.month
    day = dt.day
    # DST: last Sunday in September to first Sunday in April
    if month >= 9 and day >= _CUTOFF_SPRING[1]:
        return True
    if month <= _CUTOFF_AUTUMN[1] and day >= _CUTOFF_AUTUMN[1]:
        return False
    # For dates between, calculate exact DST transition
    # Simplified: use UTC+13 when month is Oct-Mar, UTC+12 otherwise
    return month in (10, 11, 12, 1, 2, 3)

def _now_nz():
    """Return current time in New Zealand time zone."""
    utc_now = datetime.now(timezone.utc)
    offset = timedelta(hours=13) if _is_nz_dst(utc_now) else timedelta(hours=12)
    return utc_now + offset

def _format_nz(dt=None):
    """Format datetime in New Zealand time zone."""
    if dt is None:
        dt = _now_nz()
    return dt.strftime('%Y-%m-%d %H:%M:%S')

sys.path.insert(0, str(Path(__file__).parent))
from commands import get_command, show_help, show_usage

def main():
    args = sys.argv[1:]
    if not args:
        show_usage()
        return 0
    command = args[0]
    if command in ("-h", "--help", "help"):
        show_usage()
        return 0
    handler = get_command(command)
    if handler is None:
        print(f"Error: Unknown command '{command}'", file=sys.stderr)
        print("Run 'cline_github_loop help' for usage.", file=sys.stderr)
        return 1
    return handler(args[1:])

if __name__ == "__main__":
    sys.exit(main())