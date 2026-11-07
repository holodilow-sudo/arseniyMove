"""Fetch the pinned, local-only pose runtime. Run once before packaging."""
import base64, hashlib, io, json, tarfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'app' / 'vendor'
VERSION = '1.1.1'
URL = f'https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-{VERSION}.tgz'
INTEGRITY = 'jwntgT5tzDrKOkqg6xNDNpRcTUnGvmylZE5DFnzPXossiWOIDdZX+C81LI75hlXhsG58YZW+lGzcmjH1qrQE/Q=='
MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
VENDOR.mkdir(parents=True, exist_ok=True)
data = urllib.request.urlopen(URL, timeout=120).read()
assert base64.b64encode(hashlib.sha512(data).digest()).decode() == INTEGRITY
with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
    for member in archive.getmembers():
        rel = member.name.removeprefix('package/')
        if member.isfile() and (rel in ['vision_bundle.mjs', 'package.json', 'README.md'] or rel.startswith('wasm/') or 'LICENSE' in rel):
            dest = VENDOR / rel
            assert dest.resolve().is_relative_to(VENDOR.resolve())
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(archive.extractfile(member).read())
model_path = VENDOR / 'pose_landmarker_lite.task'
model_path.write_bytes(urllib.request.urlopen(MODEL, timeout=120).read())
assert hashlib.sha256(model_path.read_bytes()).hexdigest() == '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a'
license_path = VENDOR / 'LICENSE-mediapipe.txt'
if not license_path.exists():
    license_path.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE', timeout=60).read())
manifest = {'package': '@mediapipe/tasks-vision', 'version': VERSION, 'packageSource': URL,
            'integrity': 'sha512-' + INTEGRITY, 'modelSource': MODEL, 'files': {}}
for p in VENDOR.rglob('*'):
    if p.is_file():
        manifest['files'][p.relative_to(VENDOR).as_posix()] = {'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
(ROOT / 'docs' / 'vision-assets.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'version': VERSION, 'bytes': sum(f['bytes'] for f in manifest['files'].values()), 'files': list(manifest['files'])}))
