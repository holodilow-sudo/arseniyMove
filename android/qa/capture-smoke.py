"""Read-only evidence capture for the explicitly authorized Move emulator smoke."""
from pathlib import Path
import json
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'work/android-smoke-1.0.1'
OUT.mkdir(parents=True, exist_ok=True)
ADB = ['C:/Program Files/BlueStacks_nxt/HD-Adb.exe', '-s', '127.0.0.1:5555']
label = sys.argv[1]
assert label.replace('-', '').isalnum()
def read(*args):
    return subprocess.check_output(ADB + list(args), timeout=45)
raw = read('shell', 'cat', '/sdcard/arseniy-move-smoke.xml')
tree = ET.fromstring(raw)
nodes = [{'text': n.get('text'), 'package': n.get('package'), 'id': n.get('resource-id'),
          'bounds': n.get('bounds'), 'clickable': n.get('clickable')} for n in tree.iter('node') if n.get('text')]
assert any(n.get('package') in ['ru.arseniy.move', 'com.google.android.packageinstaller', 'com.android.packageinstaller'] for n in tree.iter('node'))
(OUT / (label + '-ui.xml')).write_bytes(raw)
(OUT / (label + '.png')).write_bytes(read('exec-out', 'screencap', '-p'))
(OUT / (label + '-package.txt')).write_bytes(read('shell', 'dumpsys', 'package', 'ru.arseniy.move'))
pid = read('shell', 'pidof', 'ru.arseniy.move').decode().strip().split()[0]
(OUT / (label + '-logcat.txt')).write_bytes(read('logcat', '-d', '--pid=' + pid, '-t', '400'))
print(json.dumps(nodes, ensure_ascii=False, indent=2))
