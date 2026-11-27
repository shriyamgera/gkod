import hmac
import os
import secrets
from pathlib import Path

# No 0/O or 1/I/L, so a code read off the terminal is typed right the first time.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
GROUPS = 3
GROUP_LEN = 4


def new_code() -> str:
    groups = ("".join(secrets.choice(ALPHABET) for _ in range(GROUP_LEN)) for _ in range(GROUPS))
    return "-".join(groups)


def normalise(code: str) -> str:
    """Upper case with spaces and dashes taken out, so "k7qx m2pd 9htr" matches "K7QX-M2PD-9HTR"."""
    return "".join(ch for ch in code.upper() if ch not in " -\t")


def is_valid(code: str) -> bool:
    plain = normalise(code)
    return len(plain) == GROUPS * GROUP_LEN and all(ch in ALPHABET for ch in plain)


def matches(given: str | None, code: str) -> bool:
    if not given:
        return False
    return hmac.compare_digest(normalise(given).encode(), normalise(code).encode())


def load_or_create(path: Path, renew: bool = False) -> tuple[str, bool]:
    """The saved code, or a new one written to the file (owner-only). Returns the code and whether it is new."""
    if not renew:
        try:
            saved = path.read_text().strip()
        except OSError:
            saved = ""
        if is_valid(saved):
            return saved, False
    code = new_code()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as file:
        file.write(code + "\n")
    os.chmod(path, 0o600)
    return code, True
