# Camera and startup permissions — 1.0.2

The parent reported that capture still failed after manually enabling Android camera permission. The only reported wording was “камера не подключена”; no physical-phone log or model was supplied. This fix addresses code defects and compatibility failures rather than assuming a permission denial was the only cause.

## Packaged recognizer assets

Both FilesetResolver calls previously passed a base ending in `/vendor/wasm/`. The resolver appends `/filename`, producing `/vendor/wasm//vision_wasm_…`. The development filesystem server and Playwright's former filesystem route silently normalized the duplicate slash. Android AssetManager reads APK ZIP entries by exact name; no such double-slash ZIP entries exist. The older native interceptor passed this path unchanged to AssetManager.

Both resolver bases now omit the trailing slash. The native interceptor also normalizes repeated slashes after validating the same-origin local asset path. Traversal, queries, external origins and invalid characters remain rejected. The engine regression now enforces exact packaged paths, alongside the APK-entry regression for native normalization.

Primary implementation references: [AssetManager.open](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/content/res/AssetManager.java), [ZIP assets provider](https://android.googlesource.com/platform/frameworks/base/+/master/libs/androidfw/AssetsProvider.cpp).

## Additional repairs

- Native startup explanation appears whenever required access is missing, once per launch; sequential system dialogs request camera and Android 13+ notifications. A previous denial no longer hides the offer permanently. Already-granted permissions are skipped. Android-suppressed prompts use an explicit settings button.
- Asynchronous camera preview is permitted in the trusted local WebView after a permission dialog. Tutorial playback still starts through its controls. Camera capture itself is explicitly started by the training action.
- Camera profiles use soft constraints and bounded compatibility retries. An actual permission denial does not trigger retries. Timed-out requests never race another getUserMedia call; cancelled requests close late-returned streams.
- Front/rear selection, distinct capture/preview/model errors and locally stored diagnostic text help identify phone-specific failures. Switching cameras retains the session count, history and earned rewards.
- Package identity, signing key, data keys, exercise plan and approximately 07:00 daily reminders remain compatible with the previous release.

## Verification and limits

- `camera-stream-qa.json`: 12 capture fallback, timeout and cancellation cases.
- `camera-permission-qa.json`: 28 bridge, lifecycle sequencing and preview-error cases with mocks.
- `camera-engine-qa.json`: real packaged MediaPipe on a synthetic canvas video stream, worker and main-thread fallback, native HTTPS origin/CSP and exact asset paths. No real camera access.
- `camera-ui-qa.json`: 27 checks at 360/390 widths, camera choice/recovery, diagnostics, layout and preservation of session/history/rewards. Mock native bridge/capture failures; real pose tracker for the count-preservation case.
- `android/qa/native-verification.json`: Java compilation, startup permission policy and calendar tests. Policy tests do not simulate actual Android system dialogs.
- `dist/ArseniyMove-1.0.2-verification.json`: final signed APK, package/version, permission allowlist, alignment, exact packaged asset hashes and certificate continuity with 1.0.1.

The fixes are supported by code and regression evidence. The precise combination of failures on the child's phone is not confirmed. Actual hardware capture, device WebView performance, movement accuracy and notification delivery at 07:00 require a physical-phone retest. No uninstall, data reset or message sending is part of this update.
