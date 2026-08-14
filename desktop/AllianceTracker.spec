from pathlib import Path
from PyInstaller.utils.hooks import collect_all

root = Path(SPECPATH)
datas = [(str(root / 'agent'), 'agent')]
default_sequences = root / 'default-sequences'
if default_sequences.exists():
    datas.append((str(default_sequences), 'default-sequences'))
for asset_name in ('alliance-tracker.ico', 'GoogleSansFlex-Regular.ttf', 'GoogleSansFlex-OFL.txt'):
    asset = root / 'assets' / asset_name
    if asset.exists():
        datas.append((str(asset), 'assets'))

binaries = []
hiddenimports = []

for package in ('customtkinter', 'frida', 'tzdata'):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

a = Analysis(
    [str(root / 'main.py')],
    pathex=[str(root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='AllianceTracker',
    icon=str(root / 'assets' / 'alliance-tracker.ico'),
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
