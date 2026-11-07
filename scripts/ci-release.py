"""Trusted main-branch CI: version stamping, ephemeral signing and safe artifacts."""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NS = '{http://schemas.android.com/apk/res/android}'
REPO = 'holodilow-sudo/arseniyMove'
CERT = 'e3b08b0560d6dda65322d7aa16a4c615bae87c4d3eac8929b3392c260d266b57'

def version(value):
    if not re.fullmatch(r'(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})\.(0|[1-9][0-9]{0,4})', value):
        raise ValueError('Use a stable numeric version such as 1.0.15')
    return tuple(map(int, value.split('.')))

def api(path):
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + path,
        headers={'User-Agent': 'ArseniyMove-CI', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

def prepare(ver, code, publish=False):
    version(ver)
    if not 1 <= code <= 2100000000:
        raise ValueError('Invalid Android versionCode')
    manifest = ROOT / 'android/src/main/AndroidManifest.xml'
    original = manifest.read_text(encoding='utf-8')
    tree = ET.fromstring(original)
    old_version, old_code = tree.get(NS + 'versionName'), int(tree.get(NS + 'versionCode'))
    if code < old_code or version(ver) < version(old_version):
        raise ValueError('Version must not go backwards relative to source')
    if publish:
        latest = api('/releases/latest')
        if version(ver) <= version(latest['tag_name'].removeprefix('v')):
            raise ValueError('Published version must be newer than latest release')
        try:
            api('/releases/tags/v' + ver)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
        else:
            raise ValueError('Never overwrite an existing release')
        # The published APK is authoritative for Android versionCode.
        asset = next(a for a in latest['assets'] if a['name'] == 'ArseniyMove-' + latest['tag_name'][1:] + '.apk')
        expected = 'https://github.com/' + REPO + '/releases/download/' + latest['tag_name'] + '/' + asset['name']
        if asset['browser_download_url'] != expected or asset['size'] > 180*1024*1024:
            raise ValueError('Unexpected previous APK URL or size')
        previous = Path(os.environ['RUNNER_TEMP']) / 'move-previous.apk'
        with urllib.request.urlopen(expected, timeout=60) as response, previous.open('wb') as out:
            shutil.copyfileobj(response, out)
        if previous.stat().st_size != asset['size'] or 'sha256:' + hashlib.sha256(previous.read_bytes()).hexdigest() != asset.get('digest'):
            raise ValueError('Previous APK checksum mismatch')
        aapt = Path(os.environ['ANDROID_HOME']) / 'build-tools/35.0.0/aapt.exe'
        badging = subprocess.check_output([str(aapt), 'dump', 'badging', str(previous)], text=True)
        match = re.search(r"package: name='ru.arseniy.move' versionCode='(\d+)'", badging)
        if not match or code <= int(match[1]):
            raise ValueError('Android versionCode must exceed latest release')
    manifest.write_text(original.replace('versionName="' + old_version + '"', 'versionName="' + ver + '"')
                        .replace('versionCode="' + str(old_code) + '"', 'versionCode="' + str(code) + '"'), encoding='utf-8')
    ui = ROOT / 'app/app.mjs'
    ui.write_text(ui.read_text(encoding='utf-8').replace(old_version, ver), encoding='utf-8')
    print('Prepared version ' + ver + ', code ' + str(code))

def build():
    # Only this process sees the secret inputs. Never print their values.
    encoded = os.environ.pop('ANDROID_KEYSTORE_BASE64', '')
    password = os.environ.pop('ANDROID_KEYSTORE_PASSWORD', '')
    if not encoded or not password:
        raise RuntimeError('Configure both Android signing secrets before building')
    key = base64.b64decode(encoded, validate=True)
    if len(key) < 1000 or len(key) > 32768:
        raise ValueError('Unexpected keystore size')
    with tempfile.TemporaryDirectory(prefix='move-signing-', dir=os.environ['RUNNER_TEMP']) as temp:
        keystore = Path(temp) / 'release.p12'
        keystore.write_bytes(key)
        env = dict(os.environ, MOVE_KEYSTORE_PATH=str(keystore), MOVE_SIGNING_DIRECTORY=temp, MOVE_SIGNING_PASSWORD=password)
        try:
            subprocess.run([sys.executable, str(ROOT / 'scripts/build-android.py')], cwd=ROOT, env=env, check=True)
        finally:
            env.pop('MOVE_SIGNING_PASSWORD', None)
            keystore.unlink(missing_ok=True)
    package()

def package():
    meta = json.loads((ROOT / 'dist/build-info.json').read_text(encoding='utf-8'))
    ver = meta['version']; version(ver)
    out = ROOT / 'release-output'; out.mkdir(exist_ok=True)
    for name in [f'ArseniyMove-{ver}.apk', f'ArseniyMove-{ver}.apk.sha256']:
        shutil.copyfile(ROOT / 'dist' / name, out / name)
    instruction = ('Arseniy Move ' + ver + '\n\nУстановите APK поверх прежней версии, не удаляя приложение и не очищая данные.\n'
        'В версии 1.0.12 и новее: Настройки → Проверить обновления → подтвердить установку.\n'
        'Версии 1.0.11 и старее обновите вручную один раз. Ключи на телефоне не нужны.\n')
    (out / f'Install-{ver}.txt').write_text(instruction, encoding='utf-8')
    # Explicit source allowlist. No runner temp, build directories or signing material.
    files = []
    for folder in ['app', 'android/src/main', 'android/tools', 'scripts', 'docs', 'parent-dashboard', '.github/workflows']:
        files += [p for p in (ROOT / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts]
    files += [p for p in (ROOT / 'android/qa').glob('*') if p.suffix in {'.java', '.py', '.md'}]
    files += [ROOT / n for n in ['README.md', 'BUILDING.md', 'CI.md', '.gitignore'] if (ROOT / n).is_file()]
    archive = out / f'ArseniyMove-{ver}-source.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
        for path in sorted(set(files)):
            if path.is_symlink() or '.signing' in path.parts or path.suffix.lower() in {'.p12', '.jks', '.keystore', '.pem', '.key'}:
                raise ValueError('Forbidden source file')
            zipped.write(path, f'ArseniyMove-{ver}/' + path.relative_to(ROOT).as_posix())
    (out / (archive.name + '.sha256')).write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + '  ' + archive.name + '\n')
    report = {'version': ver, 'versionCode': meta['versionCode'], 'commit': os.environ.get('GITHUB_SHA'),
        'certificateSha256': CERT, 'apkSha256': meta['sha256'], 'signatureVerified': True,
        'source': archive.name, 'deviceInstallationTested': False}
    (out / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('Prepared APK, checksum, instructions and source archive; keystore removed')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('command', choices=['prepare', 'build'])
    parser.add_argument('--version'); parser.add_argument('--code', type=int); parser.add_argument('--publish', action='store_true')
    args = parser.parse_args()
    if args.command == 'prepare': prepare(args.version, args.code, args.publish)
    else: build()
