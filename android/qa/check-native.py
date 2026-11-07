"""Compile Android Java and verify calendar logic; never packages/installs an APK."""
from pathlib import Path
from datetime import datetime, timezone
import json
import os
import subprocess
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
ANDROID = ROOT / 'android'
QA = ANDROID / 'qa'
ENGLISH = ROOT.parent / 'arseniy-english'
TOOLS = ENGLISH / '.toolchain'
JAVA = next((TOOLS / 'jdk').rglob('java.exe'))
SDK = next((TOOLS / 'sdk-platform').rglob('android.jar'))
LAMBDA = next((TOOLS / 'sdk-build').rglob('core-lambda-stubs.jar'))
OUTPUT = QA / 'classes'
OUTPUT.mkdir(exist_ok=True)

def execute(args):
    result = subprocess.run([str(item) for item in args], capture_output=True, cwd=ROOT)
    return {'exit': result.returncode, 'stdout': result.stdout.decode('utf-8', errors='replace'),
            'stderr': result.stderr.decode('utf-8', errors='replace')}

sources = sorted((ANDROID / 'src/main/java').rglob('*.java'))
compile_result = execute([JAVA, ANDROID / 'tools/CompileAndroid.java', str(LAMBDA) + os.pathsep + str(SDK), OUTPUT, *sources, QA / 'ReminderTimeTest.java', QA / 'StartupPermissionFlowTest.java', QA / 'LocalAssetPathTest.java', QA / 'SpeechControllerTest.java'])
assert compile_result['exit'] == 0 and 'compiler task returned true' in compile_result['stdout'], compile_result
calendar = execute([JAVA, '-cp', OUTPUT, 'ru.arseniy.move.ReminderTimeTest'])
assert calendar['exit'] == 0, calendar
startup_permissions = execute([JAVA, '-cp', OUTPUT, 'ru.arseniy.move.StartupPermissionFlowTest'])
assert startup_permissions['exit'] == 0, startup_permissions
asset_paths = execute([JAVA, '-cp', OUTPUT, 'ru.arseniy.move.LocalAssetPathTest', ROOT / 'dist/ArseniyMove-1.0.1.apk'])
assert asset_paths['exit'] == 0, asset_paths

speech = execute([JAVA, '-cp', str(OUTPUT) + os.pathsep + str(SDK), 'ru.arseniy.move.SpeechControllerTest'])
assert speech['exit'] == 0, speech

ns = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(ANDROID / 'src/main/AndroidManifest.xml').getroot()
permissions = sorted(item.get(ns+'name') for item in manifest.findall('uses-permission'))
assert permissions == sorted(['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED', 'android.permission.INTERNET', 'android.permission.REQUEST_INSTALL_PACKAGES'])
assert [item.get(ns+'name') for item in manifest.findall('queries/intent/action')] == ['android.intent.action.TTS_SERVICE']
assert manifest.get('package') == 'ru.arseniy.move'
assert manifest.find('uses-sdk').get(ns+'minSdkVersion') == '26'
assert manifest.find('uses-sdk').get(ns+'targetSdkVersion') == '35'
provider = manifest.find('application/provider')
assert provider.get(ns+'authorities') == 'ru.arseniy.move.results'
assert provider.get(ns+'exported') == 'false' and provider.get(ns+'grantUriPermissions') == 'true'
for resource in (ANDROID / 'src/main/res').rglob('*.xml'):
    ET.parse(resource)

report = {'passed': True, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'javaSources': len(sources),
          'javaCompilation': compile_result, 'calendar': calendar, 'startupPermissions': startup_permissions,
          'assetPaths': asset_paths, 'speech': speech, 'speechDeviceAudibleTest': False, 'permissions': permissions,
          'manifestAndResourceXmlValid': True, 'shareProviderExported': False,
          'apkBuilt': False, 'deviceTest': False, 'realCameraAccessed': False,
          'notificationScheduledOnDevice': False, 'messengerOpened': False}
(QA / 'native-verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
