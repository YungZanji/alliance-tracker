from __future__ import annotations

from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
BASE = "https://raw.githubusercontent.com/LineageOS/android_external_google-fonts_google-sans-flex/lineage-23.2"
FILES = {
    "GoogleSansFlex-Regular.ttf": f"{BASE}/GoogleSansFlex-Regular.ttf",
    "GoogleSansFlex-OFL.txt": f"{BASE}/LICENSE",
}


def download(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "AllianceTracker-Build/0.6.1"})
    with urlopen(request, timeout=45) as response:
        return response.read()


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        data = download(url)
        if name.endswith(".ttf") and data[:4] not in (b"\x00\x01\x00\x00", b"OTTO"):
            raise RuntimeError(f"Downloaded {name} is not a valid TrueType/OpenType font.")
        if name.endswith(".txt") and b"SIL OPEN FONT LICENSE" not in data:
            raise RuntimeError("Google Sans Flex license download did not contain the expected OFL text.")
        path = ASSETS / name
        path.write_bytes(data)
        print(f"Fetched {path} ({len(data):,} bytes)")


if __name__ == "__main__":
    main()
