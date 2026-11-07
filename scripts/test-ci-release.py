"""Guard version validation and fail closed before any signing file is written."""
import importlib.util
import os
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
print('PASS: numeric versions, shell/path input rejection and fail-closed signing')
