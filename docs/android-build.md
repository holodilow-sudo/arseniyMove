# Android release build

The approved 1.0.0 APK is built locally by `scripts/build-android.py`, without Gradle, downloads, an account, or a cloud build service. The sibling English project's existing Android SDK 35 and JDK 17 toolchain are read only. The English APKs are unchanged.

## Output

- `dist/ArseniyMove-1.0.0.apk`
- Package `ru.arseniy.move`, version name `1.0.0`, version code `1`.
- Android 8.0/API 26 minimum, target/compile API 35.
- Release variant; WebView debugging disabled.
- 53,111,713 bytes.
- SHA-256 `101751afacdad835cdac796b91ab0512382261d600147a22fd0ae16f76c1dd6d`.
- APK signature v2 and v3 and four-byte ZIP alignment verified with official Android SDK tools.
- All 29 files from the frozen `app/` are byte-identical inside the APK, including model, WASM, both illustrations, instructional MP4, captions, and license/credit files.

`dist/ArseniyMove-1.0.0-build-info.json` records the assets, tool results, SDK versions, and checksum. `dist/ArseniyMove-1.0.0-build.log` retains compiler and verification output. `dist/ArseniyMove-1.0.0-verification.json` is the independent read-only package audit.

## Future compatible updates

Keep the **entire private `android/.signing` folder** securely on the development computer and include it in a private backup. It contains this app's persistent signing key and its local password file, excluded from Git and all APK packaging. Neither key nor password belongs in a shared archive or in the app. The build uses secret environment references for signing; the password is never printed or put into command arguments. Losing the key prevents a normal in-place update signed with this identity.

Future updates must retain the package ID and signing key and increment `versionCode`. The key is separate from English Quest. The script refuses to create a new identity if an earlier APK exists without its signing material.

## Compiler note

The JavaCompiler API reports a true successful compilation result. On this Windows host the JDK may log an `AccessDeniedException` when closing its SDK ZIP after compilation. The helper reports that specific cleanup warning separately, while compilation errors still stop the build; it does not suppress source diagnostics. The generated production class directory contains no QA test classes.

## Testing limits

This step builds and audits files only. No APK was installed, no real camera was accessed, no reminder was scheduled on a device, and no messenger was opened. Camera inference performance and exercise counts, Android notification delivery, and the MAX/system share chooser still require testing on the intended Android phone. The native WebView needs a sufficiently modern Android System WebView for the bundled WebAssembly inference engine. Android's notification permission is requested only when the user explicitly enables a reminder.
