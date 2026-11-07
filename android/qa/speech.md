# Native workout counter speech

`SpeechController` uses Android's installed TextToSpeech service. Constructing the activity/controller does not initialize that service. Only the local foreground app's explicit workout/test actions may prepare it or request a short utterance. The engine counter is still responsible for deciding when a repetition/time interval has been observed; speech does not affect scoring.

## JavaScript contract

All methods below are void and are exposed as `MoveNative`:

- `prepareCounterSpeech()` — explicitly warm up/check the voice without speaking; also permits retry after an unavailable result.
- `speakCounter(text)` — speak one short Russian phrase/number; initialize if not yet checked. Maximum 120 characters, Russian letters, digits, spaces and simple punctuation. This is plain text, not SSML.
- `stopCounterSpeech()` — cancel current/pending speech, including initialization work. Does not disable the user's persistent voice preference.
- `openSpeechSettings()` — user button only. Open device speech settings, or the Android accessibility settings fallback. Does not download data or auto-resume speech.

`MoveApp.nativeSpeechStatus(object)` receives:

```json
{"state":"ready","available":true,"message":"Голосовой счёт готов. Громкость регулируется как мультимедиа.","offline":true,"language":"ru-RU"}
```

Callback states are `initializing`, `ready`, `unavailable`. `available`/`offline` are true only for ready. `getCapabilities()` additionally has `nativeSpeech:true`, `speechAvailable`, `speechState`, `speechMessage`, `openSpeechSettings:true`. The capability state can be `idle` before first use or when initializing speech was cancelled. No ready/audible promise is made before initialization.

## Selection and cancellation

Only Russian (`ru`) voices reporting `isNetworkConnectionRequired() == false` and not advertising `KEY_FEATURE_NOT_INSTALLED` are eligible. Unknown feature metadata is rejected. Prefer ru-RU and lower latency. Confirm language availability, select the voice, then verify the engine actually retained that installed local voice. Do not call `setLanguage()` or automatically install/download missing data. If the default engine has no such voice, display a friendly settings/test suggestion. A different installed engine can be chosen manually in Android settings.

Speech uses `CONTENT_TYPE_SPEECH`/`USAGE_ASSISTANT` and the `STREAM_MUSIC` parameter. Activity volume buttons control media volume. `QUEUE_FLUSH` replaces this app's older utterance with the latest count. During initialization only one pending phrase is retained. Ordinary counter phrases expire after 2 seconds; the exact explicit test phrase `Проверка голоса. Один, два, три.` may wait through the existing 8-second initialization window so a successful cold start is audible. Replacement, stop and lifecycle cancellation still apply to that test phrase. Initialization times out after 8 seconds; failure is latched until explicit prepare/test, rather than restarting a service for every repetition.

Pause, background, navigation and destroy invalidate queued bridge requests. Stop clears pending text and cancels initialization callbacks/timeouts. An initializing engine is released; an already ready engine can stay warm without speaking. Destroy calls shutdown. An error belonging to a flushed/stopped old utterance cannot disrupt the current one. Foreground/trusted-document checks run again before effects and before initialization completes. Settings/navigation never trigger speech on returning automatically.

No microphone or Internet permission was added. The manifest only adds package visibility for `android.intent.action.TTS_SERVICE`. Offline selection relies on the installed engine's reported voice metadata; the app does not supply or certify a third-party voice engine.

## Verification

Run `android/qa/check-native.py`. It compiles all native Java against the Android SDK and runs `SpeechControllerTest` with a fake service/clock, checking initialization, latest-only pending speech, expiration, timeout, cancellation, stale callbacks, foreground gating, retries, cleanup, text validation, and offline-voice filtering. Existing calendar, startup permission and packaged-asset checks also run. The script asserts that runtime permissions remain unchanged and the manifest includes the TTS service query.

The fake service validates control flow, not real audio. No physical Android voice/volume/Bluetooth routing or audible Russian pronunciation has been verified here. Device acceptance still needs: offline Russian voice installed; explicit voice test; count several repetitions; mute/stop/background interrupts audio; no stale numbers after resume; missing voice shows settings guidance rather than falling back to a network voice.

## API references checked 18 October 2026

- [Android TextToSpeech](https://developer.android.com/reference/android/speech/tts/TextToSpeech): initialization, voice selection, `QUEUE_FLUSH`, `stop`, `shutdown` and the Android 11 service query.
- [TextToSpeech.Engine](https://developer.android.com/reference/android/speech/tts/TextToSpeech.Engine): `KEY_FEATURE_NOT_INSTALLED` and its potential data download when selected. Those voices are filtered before selection.
- [Android Voice](https://developer.android.com/reference/android/speech/tts/Voice): locale, network requirement, features and latency.
- [AudioAttributes](https://developer.android.com/reference/android/media/AudioAttributes): assistant usage for spoken instructions/help.
- [AOSP settings manifest](https://android.googlesource.com/platform/packages/apps/Settings/+/android16-qpr1-release/AndroidManifest.xml): explicit `com.android.settings.TTS_SETTINGS` activity. This is an AOSP action, so OEM absence is handled with the public [accessibility settings action](https://developer.android.com/reference/android/provider/Settings#ACTION_ACCESSIBILITY_SETTINGS).
