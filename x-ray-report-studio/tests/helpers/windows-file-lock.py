"""Hold a synthetic file with Windows sharing disabled until the parent closes stdin."""
import _winapi
import json
import os
import sys
from time import monotonic

GENERIC_READ_WRITE = 0xC0000000
OPEN_EXISTING = 3
FILE_ATTRIBUTE_NORMAL = 0x80

filename, nonce = sys.argv[1:]
started = monotonic()


def record(event, **details):
    print(json.dumps({
        "event": event,
        "pid": os.getpid(),
        "elapsedMs": round((monotonic() - started) * 1000),
        **details,
    }), flush=True)


record("open-start")
try:
    handle = _winapi.CreateFile(
        filename, GENERIC_READ_WRITE, 0, 0, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, 0
    )
    try:
        record("LOCKED", nonce=nonce)
        sys.stdin.buffer.read(1)
        record("release-received")
    finally:
        _winapi.CloseHandle(handle)
        record("lock-disposed")
except OSError as error:
    record("fixture-error", winerror=error.winerror, errno=error.errno)
    sys.exit(1)
