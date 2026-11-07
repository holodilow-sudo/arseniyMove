"""Guard version validation and fail closed before any signing file is written."""
import importlib.util
import os
import io
import hashlib
import tempfile
import urllib.error
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).with_name('ci-release.py')
spec = importlib.util.spec_from_file_location('ci_release', path)
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
assert module.version('1.0.15') > module.version('1.0.14')
for invalid in ['v1.0.15', '1.0', '../bad', '1.0.15\nanything', '1.0.15-beta', '01.0.15', '999999.0.0']:
    try: module.version(invalid)
    except ValueError: pass
    else: raise AssertionError('Accepted invalid version')
with patch.dict(os.environ, {'ANDROID_KEYSTORE_BASE64': '', 'ANDROID_KEYSTORE_PASSWORD': ''}):
    try: module.build()
    except RuntimeError as error: assert 'secrets' in str(error)
    else: raise AssertionError('Missing secrets must fail closed')
with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    (root / 'android/src/main').mkdir(parents=True)
    (root / 'app').mkdir()
    manifest = root / 'android/src/main/AndroidManifest.xml'
    manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:versionName="1.0.14" android:versionCode="15"/>')
    (root / 'app/app.mjs').write_text('version=1.0.14')
    previous = b'fake previous APK for version guard test'
    latest = {'tag_name': 'v1.0.14', 'assets': [{'name': 'ArseniyMove-1.0.14.apk', 'size': len(previous),
        'browser_download_url': 'https://github.com/' + module.REPO + '/releases/download/v1.0.14/ArseniyMove-1.0.14.apk',
        'digest': 'sha256:' + hashlib.sha256(previous).hexdigest()}]}
    def fake_api(path):
        if path == '/releases/latest': return latest
        raise urllib.error.HTTPError(path, 404, 'Absent', {}, None)
    with patch.object(module, 'ROOT', root), patch.object(module, 'api', fake_api), \
         patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(previous)), \
         patch.object(module.subprocess, 'check_output', return_value="package: name='ru.arseniy.move' versionCode='15'"), \
         patch.dict(os.environ, {'RUNNER_TEMP': temp, 'ANDROID_HOME': temp, 'GITHUB_OUTPUT': str(root / 'outputs')}):
        module.prepare(release=True)
    assert 'versionName="1.0.15"' in manifest.read_text()
    assert 'versionCode="16"' in manifest.read_text()
    assert (root / 'app/app.mjs').read_text() == 'version=1.0.15'
    assert (root / 'outputs').read_text() == 'version=1.0.15\n'
print('PASS: input validation, fail-closed signing, automatic next version and matching UI')
