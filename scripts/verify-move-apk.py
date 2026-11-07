"""Read-only verification of the completed Arseniy Move release APK.

Does not build, sign, install, access signing keys, open a camera or send messages.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import ctypes
import hashlib
import json
import os
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app'
VERSION = '1.0.14'
VERSION_CODE = 15
APK = ROOT / f'dist/ArseniyMove-{VERSION}.apk'
PREVIOUS_APK = ROOT / 'dist/ArseniyMove-1.0.13.apk'
OUTPUT = ROOT / f'dist/ArseniyMove-{VERSION}-verification.json'
TOOLS = Path(os.environ.get('MOVE_ANDROID_TOOLS', ROOT.parent / 'arseniy-english/.toolchain'))
ORIGIN = b'https://appassets.androidplatform.net/assets/app/index.html'
EXPECTED_PERMISSIONS = {
    'android.permission.CAMERA',
    'android.permission.INTERNET',
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.RECEIVE_BOOT_COMPLETED',
}
REQUIRED_ASSETS = [
    'index.html', 'app.mjs', 'app.css', 'theme.css', 'state.mjs', 'progress.mjs', 'updates.mjs', 'sounds.mjs',
    'voice-count.mjs', 'camera.mjs', 'camera-permission.mjs', 'camera-stream.mjs', 'pose-engine.mjs', 'vision-worker.mjs', 'report.mjs',
    'exercise-art-v2.png', 'hero-sport-v2.png',
    'media/pushup-technique.mp4', 'media/pushup-technique-ru.vtt',
    'media/pushup-poster.jpg', 'media/source-credit.txt',
    'vendor/vision_bundle.mjs', 'vendor/pose_landmarker_lite.task',
    'vendor/LICENSE-mediapipe.txt', 'vendor/package.json',
    'vendor/wasm/vision_wasm_internal.js', 'vendor/wasm/vision_wasm_internal.wasm',
    'vendor/wasm/vision_wasm_nosimd_internal.js', 'vendor/wasm/vision_wasm_nosimd_internal.wasm',
    'vendor/wasm/vision_wasm_module_internal.js', 'vendor/wasm/vision_wasm_module_internal.wasm',
]


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique(base, pattern):
    matches = list(base.rglob(pattern))
    require(len(matches) == 1, f'Expected one {pattern}, found {len(matches)}')
    return matches[0]


def ascii_path(path):
    # aapt/zipalign Windows parsers need ASCII paths. Resolve an existing alias
    # of this same file; no copying or changes to the APK or SDK are necessary.
    if str(path).isascii():
        return path
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    fn = kernel.GetShortPathNameW
    fn.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
    fn.restype = ctypes.c_uint
    for ancestor in (path, *path.parents):
        buffer = ctypes.create_unicode_buffer(32768)
        if fn(str(ancestor), buffer, len(buffer)):
            candidate = Path(buffer.value) / path.relative_to(ancestor)
            if str(candidate).isascii() and candidate.samefile(path):
                return candidate
    raise RuntimeError('Cannot resolve an ASCII alias of an existing SDK/APK path')


def run(args, ascii_args=False):
    command = [str(ascii_path(arg)) if ascii_args and isinstance(arg, Path) else str(arg) for arg in args]
    result = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=120)
    output = (result.stdout + result.stderr).decode('utf-8', errors='replace')
    require(result.returncode == 0, f'Read-only SDK check failed ({result.returncode}): {output[-3000:]}')
    return output


def inventory():
    return [{'path': file.relative_to(APP).as_posix(), 'bytes': file.stat().st_size,
             'sha256': sha(file.read_bytes())}
            for file in sorted(APP.rglob('*')) if file.is_file()]


def element_blocks(tree, tag):
    lines = tree.splitlines()
    result = []
    for index, line in enumerate(lines):
        if not re.match(rf'E: {re.escape(tag)}(?:\s|$)', line.lstrip()):
            continue
        indent = len(line) - len(line.lstrip())
        block = []
        for candidate in lines[index + 1:]:
            if candidate.strip() and len(candidate) - len(candidate.lstrip()) <= indent:
                break
            block.append(candidate)
        result.append('\n'.join(block))
    return result


def bool_attribute(block, name, expected):
    value = '0xffffffff' if expected else '0x0'
    return bool(re.search(rf'android:{re.escape(name)}[^\n]*=\(type 0x12\){value}\b', block))


def audit():
    require(APK.is_file(), 'Finished signed APK is not present yet')
    before = inventory()
    apk_bytes = APK.read_bytes()
    apk_hash = sha(apk_bytes)
    java = unique(TOOLS / 'jdk', 'java.exe')
    signer_jar = unique(TOOLS / 'sdk-build', 'apksigner.jar')
    aapt = unique(TOOLS / 'sdk-build', 'aapt.exe')
    align = unique(TOOLS / 'sdk-build', 'zipalign.exe')
    signer_output = run([java, '-jar', signer_jar, 'verify', '--verbose', '--print-certs', APK])
    certificates = sorted(set(value.lower() for value in re.findall(
        r'Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]{64})', signer_output)))
    v2 = 'Verified using v2 scheme (APK Signature Scheme v2): true' in signer_output
    require(certificates and v2, 'APK signature verification must include a certificate and APK v2 scheme')
    require(PREVIOUS_APK.is_file(), 'Previous signed APK is required to prove update certificate continuity')
    previous_hash = sha(PREVIOUS_APK.read_bytes())
    previous_signer_output = run([java, '-jar', signer_jar, 'verify', '--verbose', '--print-certs', PREVIOUS_APK])
    previous_certificates = sorted(set(value.lower() for value in re.findall(
        r'Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]{64})', previous_signer_output)))
    require(previous_certificates and certificates == previous_certificates,
            'Update signing certificate differs from the installed-version release')
    run([align, '-c', '4', APK], ascii_args=True)
    badging = run([aapt, 'dump', 'badging', APK], ascii_args=True)
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    label = re.search(r"^application-label:'([^']*)'", badging, re.MULTILINE)
    minimum = re.search(r"^sdkVersion:'(\d+)'", badging, re.MULTILINE)
    target = re.search(r"^targetSdkVersion:'(\d+)'", badging, re.MULTILINE)
    require(package and label and minimum and target, 'Compiled Android identity/SDK metadata missing')
    android = {'package': package[1], 'versionCode': int(package[2]), 'versionName': package[3],
               'label': label[1], 'minSdk': int(minimum[1]), 'targetSdk': int(target[1]),
               'debuggable': bool(re.search(r'^application-debuggable\b', badging, re.MULTILINE))}
    require(android == {'package': 'ru.arseniy.move', 'versionCode': VERSION_CODE, 'versionName': VERSION,
                        'label': 'Arseniy Move', 'minSdk': 26, 'targetSdk': 35, 'debuggable': False},
            'Unexpected compiled Android identity, version, SDK or debuggable setting')
    previous_badging = run([aapt, 'dump', 'badging', PREVIOUS_APK], ascii_args=True)
    previous_package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", previous_badging)
    require(previous_package and previous_package[1] == android['package'] and int(previous_package[2]) < VERSION_CODE,
            'Update must retain package name and increase compiled version code')
    permissions = set(re.findall(r"^uses-permission(?:-sdk-\d+)?: name='([^']+)'", badging, re.MULTILINE))
    require(permissions == EXPECTED_PERMISSIONS,
            f'Unexpected compiled permissions: {sorted(permissions ^ EXPECTED_PERMISSIONS)}')
    tree = run([aapt, 'dump', 'xmltree', APK, 'AndroidManifest.xml'], ascii_args=True)
    applications = element_blocks(tree, 'application')
    require(len(applications) == 1 and bool_attribute(applications[0], 'debuggable', False),
            'Compiled application must explicitly disable debugging')
    require(bool_attribute(applications[0], 'allowBackup', False), 'Compiled application allows backup')
    providers = element_blocks(tree, 'provider')
    require(len(providers) == 2 and any('ResultImageProvider' in p for p in providers) and any('UpdateApkProvider' in p for p in providers), 'Unexpected compiled providers')
    provider = next(p for p in providers if 'ResultImageProvider' in p)
    update_provider = next(p for p in providers if 'UpdateApkProvider' in p)
    require('ru.arseniy.move.updates' in update_provider and bool_attribute(update_provider, 'exported', False) and bool_attribute(update_provider, 'grantUriPermissions', True), 'Update provider must only use explicit temporary grants')
    require('ru.arseniy.move.results' in provider and bool_attribute(provider, 'exported', False)
            and bool_attribute(provider, 'grantUriPermissions', True),
            'Result provider must be closed with explicit temporary URI grants')
    with zipfile.ZipFile(APK) as archive:
        names = archive.namelist()
        files = [item.filename for item in archive.infolist() if not item.is_dir()]
        require(len(names) == len(set(names)), 'Duplicate archive entries')
        require(archive.testzip() is None, 'Corrupt APK ZIP member')
        forbidden_dirs = {'preview', 'work', 'build', 'scripts', 'docs', '.toolchain', '.git', '.signing', 'signing', 'node_modules', '__pycache__'}
        forbidden_suffixes = {'.jks', '.keystore', '.p12', '.pfx', '.pem', '.key', '.class', '.py', '.ps1', '.zip'}
        forbidden = []
        for name in names:
            parts = PurePosixPath(name).parts
            lower = {part.lower() for part in parts}
            if name.startswith('/') or '\\' in name or '..' in parts or lower & forbidden_dirs \
                    or PurePosixPath(name).suffix.lower() in forbidden_suffixes \
                    or any(part.lower().startswith('.env') for part in parts):
                forbidden.append(name)
        require(not forbidden, f'Build/preview/private source artifacts packaged: {forbidden[:8]}')
        expected_assets = {'assets/app/' + item['path'] for item in before}
        packaged_assets = {name for name in files if name.startswith('assets/')}
        require(packaged_assets == expected_assets,
                f'Asset set differs from frozen app: missing={sorted(expected_assets-packaged_assets)[:5]}, extra={sorted(packaged_assets-expected_assets)[:5]}')
        for item in before:
            data = archive.read('assets/app/' + item['path'])
            require(len(data) == item['bytes'] and sha(data) == item['sha256'], 'Missing/stale reviewed app asset: ' + item['path'])
        require(all('assets/app/' + name in packaged_assets for name in REQUIRED_ASSETS), 'Required offline app/model/art/video/subtitle/license asset missing')
        dex = [name for name in files if re.fullmatch(r'classes\d*\.dex', name)]
        require(dex and any(ORIGIN in archive.read(name) for name in dex), 'Trusted local application origin absent from DEX')
        require(all('ReminderTimeTest' not in archive.read(name).decode('latin1') for name in dex), 'Native QA test classes packaged')
        app_source = archive.read('assets/app/app.mjs').decode('utf-8')
        require("'arseniy-move-v1'" in app_source and "params.get('preview')==='1'" in app_source
                and "['localhost','127.0.0.1'].includes(location.hostname)" in app_source,
                'App storage/preview isolation differs from reviewed behavior')
        vision = json.loads((ROOT / 'docs/vision-assets.json').read_text(encoding='utf-8-sig'))
        for relative, expected in vision['files'].items():
            data = archive.read('assets/app/vendor/' + relative)
            require(len(data) == expected['bytes'] and sha(data) == expected['sha256'], 'Bundled MediaPipe dependency differs from audited source: ' + relative)
        subtitles = archive.read('assets/app/media/pushup-technique-ru.vtt').decode('utf-8-sig')
        require(subtitles.startswith('WEBVTT') and 'Ладони' in subtitles and subtitles.count('-->') == 4, 'Russian video captions missing or changed unexpectedly')
        video_size = len(archive.read('assets/app/media/pushup-technique.mp4'))
        require(video_size > 1_000_000, 'Instructional video is not packaged in full')
        require(archive.read('assets/app/media/source-credit.txt').strip(), 'Video source credit missing')
    require(inventory() == before, 'Reviewed app changed during the verification; rerun after source freeze')
    build_info_path = APK.with_name(APK.stem + '-build-info.json')
    metadata = json.loads(build_info_path.read_text(encoding='utf-8-sig'))
    require(metadata['apk'] == APK.name and metadata['sha256'] == apk_hash and metadata['bytes'] == len(apk_bytes),
            'Build metadata hash/name/size does not describe this APK')
    require(metadata['version'] == VERSION and metadata['versionCode'] == VERSION_CODE and metadata['variant'] == 'local-release',
            'Build metadata version/variant differs')
    checksum = APK.with_name(APK.name + '.sha256').read_text(encoding='utf-8-sig').split()
    require(checksum and checksum[0].lower() == apk_hash, 'SHA-256 sidecar differs from finished APK')
    require(sha(APK.read_bytes()) == apk_hash, 'APK changed during verification')
    return {
        'passed': True, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'apk': APK.name,
        'bytes': len(apk_bytes), 'sha256': apk_hash, 'android': android,
        'signature': {'verified': True, 'v2': v2, 'certificateSha256': certificates},
        'updateCompatibility': {'previousApk': PREVIOUS_APK.name, 'previousSha256': previous_hash,
                                'sameSigningCertificate': True, 'samePackage': True,
                                'versionCodeIncreased': True, 'persistentStore': 'arseniy-move-v1'},
        'alignment4Bytes': True, 'compiledPermissions': sorted(permissions),
        'noContactsMicrophoneStoragePermissions': True,
        'internetForGithubUpdates': True, 'installationRequiresUserConfirmation': True,
        'compiledProvider': {'authority': 'ru.arseniy.move.results', 'exported': False, 'grantUriPermissions': True},
        'packagedAppFilesMatchFrozenSource': len(before), 'appInventory': before,
        'appInventorySha256': sha(json.dumps(before, sort_keys=True, separators=(',', ':')).encode('utf-8')),
        'requiredAssetsPresent': REQUIRED_ASSETS, 'mediaPipeInventoryVerified': len(vision['files']),
        'offlineVideoBytes': video_size, 'russianSubtitlesCues': 4,
        'buildInfoAndChecksumMatch': True, 'noPreviewBuildOrSigningFilesPackaged': True,
        'trustedLocalOrigin': ORIGIN.decode('ascii'), 'deviceInstallTest': False,
        'apkRuntimeTested': False, 'realCameraTested': False, 'actualMessengerSendTest': False,
        'maxOpened': False,
        'limitations': ['Archive, compiled manifest and signature audited without installation.',
                        'Physical exercise accuracy and MAX handoff still need testing on an Android device.']
    }


if __name__ == '__main__':
    try:
        report = audit()
    except Exception as error:
        report = {'passed': False, 'checkedAt': datetime.now(timezone.utc).isoformat(),
                  'apk': APK.name, 'error': str(error), 'deviceInstallTest': False,
                  'apkRuntimeTested': False, 'realCameraTested': False, 'actualMessengerSendTest': False}
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        raise
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
