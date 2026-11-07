"""Build and verify the standalone local-release APK without Gradle or networking."""
from pathlib import Path
from datetime import datetime, timezone
import ctypes
import hashlib
import json
import os
import re
import secrets
import shutil
import struct
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLS = Path(os.environ.get('MOVE_ANDROID_TOOLS', ROOT.parent / 'arseniy-english' / '.toolchain'))
SOURCE = ROOT / 'android/src/main'
DIST = ROOT / 'dist'
BUILD = ROOT / 'build' / datetime.now().strftime('%Y%m%d-%H%M%S')
BUILD.mkdir(parents=True)
LOG = BUILD / 'build.log'
STEPS = []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ascii_path(path):
    """Use an identity-checked short path for Windows SDK path handling."""
    path = path.resolve()
    if str(path).isascii():
        return path
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    short = kernel.GetShortPathNameW
    short.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
    short.restype = ctypes.c_uint
    for ancestor in (path, *path.parents):
        buffer = ctypes.create_unicode_buffer(32768)
        if short(str(ancestor), buffer, len(buffer)):
            candidate = Path(buffer.value) / path.relative_to(ancestor)
            if str(candidate).isascii() and candidate.samefile(path):
                return candidate
    raise RuntimeError('No verified ASCII alias for Android SDK path')


def find(base, pattern):
    paths = list(base.rglob(pattern))
    if len(paths) != 1:
        raise RuntimeError(f'Expected exactly one {pattern}: found {len(paths)}')
    return paths[0]


def run(label, args, ascii=False, env=None):
    print(label, flush=True)
    argv = [str(ascii_path(a)) if ascii and isinstance(a, Path) else str(a) for a in args]
    result = subprocess.run(argv, cwd=ascii_path(ROOT) if ascii else ROOT,
                            capture_output=True, env=env)
    out = result.stdout.decode('utf-8', errors='replace')
    err = result.stderr.decode('utf-8', errors='replace')
    # Store tool output and labels only, never secret environment contents.
    with LOG.open('a', encoding='utf-8') as log:
        log.write(f'\n{label}\nexit={result.returncode}\n{out}{err}\n')
    if out:
        print(out.rstrip(), flush=True)
    if err:
        print(err.rstrip(), flush=True)
    STEPS.append({'step': label, 'exitCode': result.returncode})
    if result.returncode:
        raise RuntimeError(f'{label} failed: exit {result.returncode}. See {LOG}')
    return out + err


def main():
    # CI uses the hosted runner's SDK/JDK and an ephemeral external keystore.
    ci = os.environ.get('GITHUB_ACTIONS') == 'true'
    if ci and not all(os.environ.get(k) for k in ['MOVE_KEYSTORE_PATH', 'MOVE_SIGNING_PASSWORD']):
        raise RuntimeError('CI signing secrets are required; never create a replacement identity')
    jdk = Path(os.environ['JAVA_HOME']) / 'bin' if ci else find(TOOLS / 'jdk', 'javac.exe').parent
    sdk = Path(os.environ['ANDROID_HOME']) / 'build-tools/35.0.0' if ci else find(TOOLS / 'sdk-build', 'aapt2.exe').parent
    android = Path(os.environ['ANDROID_HOME']) / 'platforms/android-35/android.jar' if ci else find(TOOLS / 'sdk-platform', 'android.jar')
    for part in ['compiled-resources', 'linked', 'generated', 'classes', 'dex']:
        (BUILD / part).mkdir()
    DIST.mkdir(exist_ok=True)
    linked = BUILD / 'linked'
    ns = '{http://schemas.android.com/apk/res/android}'
    ET.register_namespace('android', ns[1:-1])
    manifest = ET.parse(SOURCE / 'AndroidManifest.xml')
    root = manifest.getroot()
    assert root.get('package') == 'ru.arseniy.move'
    version = root.get(ns + 'versionName')
    version_code = int(root.get(ns + 'versionCode'))
    root.find('application').set(ns + 'debuggable', 'false')
    build_manifest = BUILD / 'AndroidManifest.xml'
    manifest.write(build_manifest, encoding='utf-8', xml_declaration=True)
    for folder in (SOURCE / 'res').iterdir():
        if folder.is_dir():
            (linked / 'res' / folder.name).mkdir(parents=True)
    run('1/8 Compile resources', [sdk / 'aapt2.exe', 'compile', '--dir', SOURCE / 'res',
                                 '-o', BUILD / 'compiled-resources'], ascii=True)
    run('2/8 Link resources', [sdk / 'aapt2.exe', 'link',
        *sorted((BUILD / 'compiled-resources').glob('*.flat')), '--output-to-dir', '-o', linked,
        '--manifest', build_manifest, '-I', android, '--java', BUILD / 'generated'], ascii=True)

    # This allowlist boundary excludes build/test/preview/signing sources.
    asset_source = ROOT / 'app'
    for path in asset_source.rglob('*'):
        if path.is_symlink():
            raise RuntimeError('Symlinks are not allowed in packaged app assets')
        if path.is_file() and (path.name.startswith('.') or path.suffix in {'.p12', '.jks', '.keystore', '.pem'}):
            raise RuntimeError('Private or hidden file found in app assets')
    asset_hashes = {path.relative_to(asset_source).as_posix(): digest(path)
                    for path in sorted(asset_source.rglob('*')) if path.is_file()}
    shutil.copytree(asset_source, linked / 'assets/app')
    sources = sorted((SOURCE / 'java').rglob('*.java')) + sorted((BUILD / 'generated').rglob('*.java'))
    boot = str(sdk / 'core-lambda-stubs.jar') + os.pathsep + str(android)
    compiled = run('3/8 Compile Android Java', [jdk / 'java.exe', ROOT / 'android/tools/CompileAndroid.java',
                  boot, BUILD / 'classes', *sources])
    if 'compiler task returned true' not in compiled:
        raise RuntimeError('Compiler did not report a successful task result')
    classes = BUILD / 'classes.jar'
    with zipfile.ZipFile(classes, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted((BUILD / 'classes').rglob('*.class')):
            archive.write(path, path.relative_to(BUILD / 'classes').as_posix())
    run('4/8 Convert bytecode', [jdk / 'java.exe', '-cp', sdk / 'lib/d8.jar',
        'com.android.tools.r8.D8', '--lib', android, '--min-api', '26', '--output', BUILD / 'dex', classes])

    print('5/8 Package local app assets', flush=True)
    unsigned = BUILD / 'unsigned-aligned.apk'
    entries = [(p.relative_to(linked).as_posix(), p) for p in sorted(linked.rglob('*')) if p.is_file()]
    entries += [(p.name, p) for p in sorted((BUILD / 'dex').glob('*.dex'))]
    # Stored/aligned assets also let AssetManager.openFd serve MP4 byte ranges.
    with zipfile.ZipFile(unsigned, 'w', compression=zipfile.ZIP_STORED) as archive:
        for name, path in entries:
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_STORED
            offset = archive.fp.tell() + 30 + len(name.encode('utf-8'))
            pad = (-offset) % 4
            if pad:
                info.extra = struct.pack('<HH', 0xFFFF, pad) + bytes(pad)
            archive.writestr(info, path.read_bytes())
    run('Verify unsigned ZIP alignment', [sdk / 'zipalign.exe', '-c', '4', unsigned])

    signing = Path(os.environ['MOVE_SIGNING_DIRECTORY']) if ci else ROOT / 'android/.signing'
    signing.mkdir(exist_ok=True)
    (signing / '.gitignore').write_text('*\n', encoding='utf-8')
    key = Path(os.environ['MOVE_KEYSTORE_PATH']) if ci else signing / 'arseniy-move-release.p12'
    secret_file = signing / 'signing-password.txt'
    if not ci and key.exists() != secret_file.exists():
        raise RuntimeError('Signing key and password must both exist; refusing an incompatible replacement')
    if not key.exists() and list(DIST.glob('ArseniyMove-*.apk')):
        raise RuntimeError('Existing APK without its update signing key; refusing to replace key')
    if ci:
        if not key.is_file():
            raise RuntimeError('CI keystore is missing')
        password = os.environ['MOVE_SIGNING_PASSWORD']
    elif key.exists():
        password = secret_file.read_text(encoding='utf-8').strip()
    else:
        password = secrets.token_urlsafe(48)
        # Exclusive creation preserves one stable key/password for future updates.
        with secret_file.open('x', encoding='utf-8') as file:
            file.write(password + '\n')
    env = os.environ.copy()
    env['MOVE_SIGNING_PASSWORD'] = password
    if not key.exists():
        run('Create persistent Arseniy Move signing key', [jdk / 'keytool.exe', '-genkeypair',
            '-storetype', 'PKCS12', '-keystore', key, '-storepass:env', 'MOVE_SIGNING_PASSWORD',
            '-keypass:env', 'MOVE_SIGNING_PASSWORD', '-alias', 'arseniymove', '-keyalg', 'RSA',
            '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Arseniy Move, O=Local App, C=RU',
            '-noprompt'], env=env)
    signer = [jdk / 'java.exe', '-jar', sdk / 'lib/apksigner.jar']
    apk = DIST / f'ArseniyMove-{version}.apk'
    run('6/8 Sign release APK', [*signer, 'sign', '--ks', key, '--ks-key-alias', 'arseniymove',
        '--ks-pass', 'env:MOVE_SIGNING_PASSWORD', '--key-pass', 'env:MOVE_SIGNING_PASSWORD',
        '--out', apk, unsigned], env=env)
    env.pop('MOVE_SIGNING_PASSWORD', None)
    signature = run('7/8 Verify APK signature', [*signer, 'verify', '--verbose', '--print-certs', apk])
    assert 'Verified using v2 scheme (APK Signature Scheme v2): true' in signature
    certificates = re.findall(r'Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9]{64})', signature)
    assert certificates == ['e3b08b0560d6dda65322d7aa16a4c615bae87c4d3eac8929b3392c260d266b57'], 'Unexpected signing identity'
    run('Verify signed ZIP alignment', [sdk / 'zipalign.exe', '-c', '4', apk])
    badging = run('8/8 Verify compiled package', [sdk / 'aapt.exe', 'dump', 'badging', apk], ascii=True)
    assert f"package: name='ru.arseniy.move' versionCode='{version_code}' versionName='{version}'" in badging
    assert 'application-debuggable' not in badging
    assert "sdkVersion:'26'" in badging and "targetSdkVersion:'35'" in badging
    with zipfile.ZipFile(apk) as archive:
        packaged = {name[len('assets/app/'):]: hashlib.sha256(archive.read(name)).hexdigest()
                    for name in archive.namelist() if name.startswith('assets/app/')}
        assert packaged == asset_hashes, 'Packaged assets differ from frozen app source'
    current_hashes = {p.relative_to(asset_source).as_posix(): digest(p)
                      for p in sorted(asset_source.rglob('*')) if p.is_file()}
    assert current_hashes == asset_hashes, 'App source changed during build'
    sha = digest(apk)
    permissions = sorted(p.get(ns + 'name') for p in root.findall('uses-permission'))
    metadata = {'apk': apk.name, 'version': version, 'versionCode': version_code, 'package': root.get('package'),
        'variant': 'local-release', 'bytes': apk.stat().st_size, 'sha256': sha,
        'createdAt': datetime.now(timezone.utc).isoformat(), 'minSdk': 26, 'targetSdk': 35, 'compileSdk': 35,
        'build': str(BUILD), 'buildLog': str(LOG), 'javaSources': len(sources), 'permissions': permissions,
        'assetsCount': len(asset_hashes), 'assetHashes': asset_hashes, 'allAssetsByteIdentical': True,
        'localPoseModelBundled': True, 'wasmBundled': True, 'instructionalVideoBundled': True,
        'cameraFramesSentToNetwork': False, 'deviceInstallTest': False, 'realCameraTest': False,
        'reminderDeviceTest': False, 'messengerDeviceTest': False,
        'signingKey': 'Persistent local private key; retain android/.signing for compatible updates',
        'signatureVerified': True, 'zipAlignmentVerified': True, 'debuggable': False, 'steps': STEPS}
    report = json.dumps(metadata, ensure_ascii=False, indent=2)
    (DIST / 'build-info.json').write_text(report, encoding='utf-8')
    (DIST / (apk.stem + '-build-info.json')).write_text(report, encoding='utf-8')
    (DIST / (apk.name + '.sha256')).write_text(sha + '  ' + apk.name + '\n', encoding='utf-8')
    shutil.copyfile(LOG, DIST / (apk.stem + '-build.log'))
    print(json.dumps({'apk': str(apk), 'bytes': apk.stat().st_size, 'sha256': sha, 'passed': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
