# Arseniy Move — Android shell

Package: `ru.arseniy.move`, current version `1.0.5` / code `6`. This is a separate app and uses no English Quest package or saved progress. Minimum Android 8 / API 26; target API 35. A current Android System WebView is required for camera capture, WebAssembly and MediaPipe.

## Spoken counter 1.0.5

Repetitions are announced in Russian when the counter increases. Plank announces each ten-second boundary of recognized holding time. No recorded camera audio or microphone access is involved. The native shell uses an installed, offline Russian Android TextToSpeech voice, initialized only for an explicit workout or voice test. Missing voices produce an actionable status and an explicit button for phone TTS settings; no voice download or settings launch happens automatically.

Voice counting and interface sounds have independent saved preferences. The header speaker mutes both. The controller replaces an old utterance with the latest count; pause, finish, navigation and backgrounding cancel pending speech. Resume starts at the current count without replay. Preview/history/results never automatically recite counts. The speech implementation and native test limits are documented in `../android/qa/speech.md`; actual sound and volume still need checking on the phone with «Проверить голос».

The package, signing key, state storage, free-count logic, camera tolerance, reminders and PNG sharing are unchanged. The only manifest addition is TTS service package visibility, not a permission. No microphone or INTERNET permission was added.

The original signed release was built on 2026-10-17. Version 1.0.1 was smoke-tested as an update in BlueStacks, preserving its UID and first-install timestamp. The parent subsequently reported camera failure on the physical phone even after manually granting access. The user confirmed working physical-phone capture and pose overlay after the camera fix, then reported missed repetitions. Version 1.0.3 corrects counter timing and projected support geometry, and caps inference frames to 640 pixels. The parent later reported that the app worked well and requested free counting with a small tolerance, delivered in 1.0.4. These user reports do not establish audible speech or notification delivery on that phone: the new voice feature needs the in-app test. See `camera-1.0.2.md` for the earlier fix and its evidence.

## Local app and camera

The single trusted document is `https://appassets.androidplatform.net/assets/app/index.html`. `app/` must be packaged at `assets/app/`, including local model, WASM and JavaScript files. `.mjs` receives `application/javascript`, `.wasm` receives `application/wasm`, and `.task`/`.tflite` receive `application/octet-stream`. Local tutorial `.mp4` uses `video/mp4`, `.vtt` uses `text/vtt`; the MP4 is stored with fast-start metadata. Tutorial playback pauses on background together with camera cleanup. Actual Android playback/seeking still requires a device check.

The manifest has no `INTERNET` permission. WebView blocks network loads; its interceptor serves only validated local asset paths and rejects other requests. File/content access, external navigation, frames, forms, popups and geolocation are disabled. The response CSP permits same-origin model fetches and WASM compilation, plus local/blob workers. It does not permit external scripts or connections. COOP/COEP/CORP headers keep packaged resources same-origin.

Version 1.0.2 offers missing CAMERA and notification access on opening, once per Activity launch. It replaces the persisted `startupRequested` marker in 1.0.1, which suppressed future offers after a denial or interrupted request. The native explanation's Continue button requests CAMERA, then POST_NOTIFICATIONS on Android 13+. Granted permissions are skipped; blocked permissions or notification channels lead to an explicit settings button. Android 8–12 has no notification runtime dialog. This happens at runtime, never inside Android's installation process. Permission grants do not start camera capture. The frontend explicitly awaits `requestCameraPermission` before `getUserMedia({video: ..., audio: false})`. The WebChromeClient accepts only `VIDEO_CAPTURE` for the trusted origin and live document. Audio and additional resources are denied. The pending WebView request survives a temporary permission dialog, but cancellation, navigation, actual backgrounding, or destruction clear/deny it.

The local trusted WebView permits asynchronous video playback (`setMediaPlaybackRequiresUserGesture(false)`); the app still requests capture only from its explicit training action. Camera requests use ideal constraints, then simpler profiles only after hardware/constraint errors. Permission denials are not retried as hardware errors. Capture and preview have bounded timeouts, and late streams are closed after cancellation. Front/rear choice is saved separately from training progress. The error screen records the stage, error, application/Android/WebView version and model locally; it contains no frames or device identifiers and is never sent automatically.

On ordinary `onPause`, the native shell calls `window.MoveApp.pauseForBackground()` and stops attached video tracks before pausing WebView. While its own Android permission dialog is pending, this cleanup is deferred: the previous unconditional cancellation could reject capture even after tapping Allow. `onStop` always performs cleanup, including when the user leaves while a permission dialog is open. Permission results arriving before `onResume` are deferred, and never start capture in the background. The frontend hook must invalidate pending camera/model work and stop any late returned stream. Returning from background does not automatically reopen capture. No frames are uploaded or recorded. There are no microphone, storage, contacts or location permissions.

Physical devices use hardware rendering. No emulator-specific software-rendering workaround is enabled for this camera app: low-end devices and emulators may lack the WebGL/WASM/camera capabilities needed for tracking. Actual frame rate, tracking accuracy and camera permission behavior still need testing on a phone. No real camera was accessed during development checks.

## Native bridge

```js
const capabilities = JSON.parse(window.MoveNative.getCapabilities());
// {
//   available: true, platform: 'android', version: 2,
//   camera: true, cameraPermission: false, nativeCameraPermission: true,
//   cameraPermissionState: 'prompt', permissionPromptActive: false, openAppSettings: true,
//   imageShare: true, imageSave: false, localProcessing: true, nativeReminders: true,
//   reminder: { enabled, days, time, status, active, nextAt,
//     precision: 'inexact', timezone, notificationPermission,
//     notificationsAvailable }
// }
```

The bridge is available before module scripts on the trusted page begin. `camera` means the device advertises a camera, not that motion tracking has passed. `cameraPermission` reflects Android permission, not a live camera stream. `getCapabilities()` is read-only and never prompts. `available:false` may be returned if the document is being destroyed or replaced.

```js
MoveNative.requestCameraPermission('camera-unique-id');
window.MoveApp.nativeCameraPermissionResult = function (result) {
  // {requestId, status, granted, canAskAgain, state}; object, not JSON text.
  // Start getUserMedia only for a still-live foreground request with status 'granted'.
};
// Only on an explicit settings button click:
MoveNative.openAppSettings();
```

Request IDs are 1–80 ASCII letters, digits, underscores or hyphens. Camera callback statuses are `granted`, `denied`, `settings_required`, `cancelled`, `busy`, and `unavailable`. State values are `granted`, `prompt`, `denied`, or `settings_required`. An explicit request joins an already-active startup dialog. A request made during a notification-only prompt is deferred until that prompt ends. Permanent denial is detected after an actual denied permission result together with Android's rationale state; it opens no settings window automatically. After a settings visit the frontend refreshes capabilities. Only this app's settings URI can be opened.

After a runtime permission result and on Activity resume, the shell calls `MoveApp.nativePermissionsChanged()` if that handler exists on the trusted document. The frontend reads fresh capabilities/reminder state; this callback never starts capture or opens another dialog itself.

The Back button first closes a `CityShare` dialog if present, then calls `window.MoveApp.handleBack()`. Return `true` when the frontend handled navigation or opened its own leave-confirmation dialog. Otherwise Android shows a normal exit confirmation. `MoveApp.pauseForBackground` must be safe to call repeatedly.

## Weekly reminders

The parent explicitly requested **every day at approximately 07:00 local time** for version 1.0.1. A one-time native migration sets `[1,2,3,4,5,6,7]`, `07:00`, enabled, on first opening this version for both fresh installs and upgrades. Its marker is saved with the configuration. Later user changes, including disabling, are retained without reapplying the default. The schedule is inactive until notifications are allowed. Further frontend changes use the explicit save action:

```js
MoveNative.scheduleReminder(JSON.stringify({
  enabled: true,
  days: [1, 3, 5], // ISO Monday=1 through Sunday=7; example only
  time: '18:30',  // 24-hour device-local time; example only
  requestId: 'reminder-1'
}));

// Disabling requires no permission and cancels the pending reminder.
MoveNative.scheduleReminder(JSON.stringify({ enabled: false, requestId: 'reminder-2' }));

window.MoveApp.nativeReminderResult = function (result) {
  // Object, not a JSON string. Contains reminder state and requestId.
};
```

Enabled schedules require at least one valid weekday and `HH:mm`. Duplicate weekdays are normalized. Invalid input leaves saved preferences unchanged. The app stores one schedule locally and arms only its next occurrence. After a reminder fires, it calculates and arms the next chosen weekday. Schedule edits replace the pending alarm rather than accumulating duplicates. Boot, time-zone, manual clock changes and package replacement restore the existing user choice; these receivers never enable reminders or request permissions by themselves.

The scheduler uses `AlarmManager.setAndAllowWhileIdle`, an **inexact** API, with immutable PendingIntents. There is no exact-alarm special permission. Android may delay delivery for battery saving, Doze, manufacturer restrictions or a stopped app. Therefore the UI should say “примерно в выбранное время”, not promise an exact minute. Force-stopping the app can disable reminders until the app is opened again. Delayed alarms older than six hours are discarded instead of delivering a stale prompt. Daylight-saving gaps move to the next valid local time; a repeated clock hour produces one reminder, not two.

Android 13+ notification permission is requested in the one-time first-open flow, or when the user explicitly saves an enabled schedule if Android allows another request. A blocked permission does not trigger repeated dialogs; settings can be opened explicitly. The schedule remains saved if permission is declined, but `active:false` makes clear that no alarm is armed. App resume can restore it after the user enables notifications in settings. Blocking the app or its notification channel reports inactive status. Disabling cancels the alarm and visible notification.

Callback statuses:

| Status | Meaning |
| --- | --- |
| `scheduled` | Next inexact alarm is armed; `nextAt` is its requested epoch-millisecond time. |
| `disabled` | User preference is off and alarms are cancelled. |
| `permission_requested` | Android notification permission dialog was requested; not a success claim. |
| `permission_required` | Notification permission is absent; saved schedule is inactive. |
| `notifications_blocked` | App notifications or the reminder channel are blocked. |
| `invalid` | Schedule was rejected; previous valid preference is retained. |
| `busy` | An Android runtime permission request is already pending. |
| `unavailable` | Native settings/alarm facility could not complete the operation. |
| `current` | Read-only status returned inside capabilities. |

Four supportive notification texts rotate by local calendar day, mentioning a short warm-up, experience, achievements or a new level. They do not claim that a rating will drop. Tapping opens the app and never starts a camera or workout automatically.

## Share a result

```js
AndroidShare.shareImage(pngDataUrl, 'share-unique-request-id');
window.MoveApp.nativeShareResult = function (requestId, status) {};
```

The primary callback is `MoveApp.nativeShareResult(requestId, status)`. For reused browser components only, `CityShare.nativeResult` is a fallback if the primary callback is absent. Request IDs must match `share-[a-zA-Z0-9-]{1,64}`. Payloads are PNG data URLs of at most approximately 4 MiB decoded, at most 1800 pixels per side and 2.5 million pixels total. Native code checks the PNG header, decodes dimensions, decodes/re-encodes the image and stores it in private cache.

The read-only provider `ru.arseniy.move.results` is not exported. It only serves canonical generated result-card paths with temporary URI read grants via `EXTRA_STREAM` and ClipData. It rejects writes and does not expose other app files. Cache cleanup keeps at most twelve recent cards and removes cards older than 48 hours at the next creation.

Statuses are `opened`, `invalid`, `busy`, `unavailable` and `error`. `opened` only confirms Android's share chooser opened. The child selects MAX or another installed messenger, selects the recipient, and presses Send. There is no automatic sending, recipient lookup, messenger package targeting, or claim that Dad received anything. Native chooser and MAX compatibility have not yet been tested on a phone.

The native shell does not support browser blob-anchor downloads or provide a separate save-to-device bridge (`imageSave:false`). Hide the browser “Сохранить картинку” action on Android and use the standard share chooser; an installed file app may offer a save destination. Do not treat a blob anchor click as a successful Android save. A dedicated save action would need a separately implemented Storage Access Framework `ACTION_CREATE_DOCUMENT` flow.

## Verification

`android/qa/check-native.py` compiles the seven Android Java sources with the existing local JDK 17 / API 35 toolchain, then executes fifteen calendar-policy assertions, including daily 07:00 boundaries. It does not package, sign, install or launch an APK. XML parsing checks the manifest, resource files, exact permission list and private share provider.

Passed evidence: `android/qa/native-verification.json`. Calendar checks include ISO weekdays, same-day and next-week selection, month boundary, device time zone, missing DST hour and repeated DST hour. JavaCompiler's task returned true with exit 0. This Windows environment still emits a controlled SDK ZIP cleanup warning after the successful compiler task, as in the English app toolchain.

Not tested yet: real camera capture, MediaPipe processing in Android WebView, actual notification delivery, lifecycle on a physical phone, and messenger attachment/delivery. These need the approved APK and a device test; compiler checks do not establish them.


## Free counting 1.0.4

All four exercises now finish on explicit user confirmation, not a fixed goal. New sessions keep mode=free and goal=null; existing goal-based history stays readable. Package, signing key, storage key, sharing provider and reminder preferences remain unchanged. Counter tolerance for push-ups/squats changes only in the JS pose engine.
