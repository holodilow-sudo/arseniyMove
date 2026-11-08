# Camera movement tracker

`app/pose-engine.mjs` is a deterministic landmark-based movement counter. It does not open the camera, run the pose model, record video, recognize identity, send network requests, persist data, or grant internet time. The application owns those integration decisions. No accuracy claim has been established using physical exercise sessions.

## API

```js
import {createTracker} from './pose-engine.mjs';

const tracker = createTracker({exercise: 'pushup'});
// exercise: 'pushup' | 'squat' | 'plank' | 'pullup'

const result = tracker.update({
  landmarks: detected.landmarks[0],       // One pose: 33 normalized landmarks
  worldLandmarks: detected.worldLandmarks?.[0], // Optional, same frame
  timestamp: performance.now(),           // Strictly increasing milliseconds
  aspectRatio: video.videoWidth / video.videoHeight
});

// {
//   count: 2,
//   holdSeconds: 0,
//   phase: 'top',
//   tracking: true,
//   feedback: 'Повтор засчитан.',
//   metrics: {
//     exercise: 'pushup', reason: null,
//     side: 'left', source: 'image', confidence: .99,
//     elbowAngle: 174.2, kneeAngle: 170.1,
//     hipAngle: 172.4, bodyLineAngle: 174.5,
//     continuousHoldSeconds: 0, repStage: 'start', approximate: false
//   }
// }

tracker.pause(); // Preserves totals, clears in-progress cycle and continuity.
tracker.reset(); // Clears count/time and all tracking state.
```

`tracking` indicates that the current frame is sufficiently visible, in frame and compatible with this exercise's coarse geometric checks. It is not a certification of technique. `count` changes only on completion of a valid full cycle; use `count > previous.count` for the UI reward event. `holdSeconds` is the accumulated visible plank time, with millisecond precision. For the display use `Math.floor(holdSeconds)`; do not round upward to complete a time goal early.

Phases:

| Exercise | Phases |
|---|---|
| Push-ups / squats | `setup`, `top`, `lowering`, `bottom`, `rising` |
| Pull-ups | `setup`, `hang`, `lifting`, `top`, `lowering` |
| Plank | `setup`, `holding` |
| Explicit pause | `paused` until the next update |

The `feedback` string is already in Russian and suitable for a concise camera overlay. `metrics.reason` is a stable diagnostic category; null means no rejection. Do not use `metrics` to label an exercise medically safe or technically perfect. `metrics.approximate` specifically flags the extra pull-up limitations; false for another exercise does not mean certified accuracy.

## Input and lifecycle requirements

- Process only **fresh decoded video frames**. With an HTML video, compare `video.currentTime` to the previously processed value, or use `requestVideoFrameCallback`. Repeated rendering of a frozen frame must not call the engine as if it were new camera input.
- Pass raw model coordinates and the actual video width/height ratio. CSS `object-fit`, letterboxing, preview dimensions and display mirroring must not change the engine's input aspect ratio. A mirrored preview can draw mirrored landmarks, while the engine still consumes the unmodified model result.
- Only pass a single intended pose. The engine does not recognize a person or select the correct person among several people.
- `visibility` must be present and at least 0.65 on every essential joint. If `presence` is supplied it must be a finite probability of at least 0.60; omission of `presence` is allowed, omission of `visibility` is not. The model's confidence settings and these landmark filters are different checks.
- Call `pause()` on `visibilitychange` when hidden, `pagehide`, app backgrounding, camera stop, permission loss, exercise change and manual pause. Resume only with fresh frames. `update` additionally rejects a hidden browser document and gaps over 500 ms.
- While tracking is absent, pass `landmarks: []` for that timestamp, or call `pause()` when the stream has stopped. An absent pose must never be replaced with the previous good landmarks.
- Warm up the camera/model separately. Do not feed screenshot or demo fixtures into a real workout or time-request report.

Example frame/lifecycle integration:

```js
let previousVideoTime = -1;
let running = true;

function cameraFrame() {
  if (!running || document.hidden) { tracker.pause(); return; }
  if (video.readyState >= 2 && video.currentTime !== previousVideoTime) {
    previousVideoTime = video.currentTime;
    const timestamp = performance.now();
    const detection = poseLandmarker.detectForVideo(video, timestamp);
    updateUI(tracker.update({
      landmarks: detection.landmarks[0] || [],
      worldLandmarks: detection.worldLandmarks?.[0],
      timestamp,
      aspectRatio: video.videoWidth / video.videoHeight
    }));
  }
  requestAnimationFrame(cameraFrame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) tracker.pause();
});
window.addEventListener('pagehide', () => tracker.pause());
```

## Camera placement

- **Push-ups and plank:** a steady side view with shoulder, elbow, wrist, hip, knee and ankle visible. Landscape framing is often easier for a horizontal body. Keep the body away from image edges. The engine must see raised support and a sufficiently straight visible body line.
- **Squats:** a steady side or slight side view showing shoulder, hip, knee and ankle throughout standing and bending. Keep feet in the frame; moving the phone while performing the movement invalidates the reference.
- **Pull-ups:** front or slight front angle, with both wrists, elbows, shoulders, hips, knees and ankles visible throughout. The person and raised hands need to fit in frame. Keep the actual bar visible to the person reviewing the session; this engine does not detect the bar itself.

This is framing guidance for the prototype, not an individualized exercise prescription. The app should allow a pause or skipped exercise without framing a tracking failure as a personal failure.

## How counting works

The counter chooses a sufficiently confident visible side for push-ups, squats and plank and retains it while usable. Losing that side and changing to the other resets the incomplete repetition. Pull-ups require both sides. Essential points must be inside a 1.5% frame margin, and non-degenerate body/limb spans must be visible.

For image-only angles, x is multiplied by `aspectRatio` before the angle is calculated. Normalized z is deliberately unused in 2-D calculations. Valid world landmarks can supply 3-D joint angles; confidence and image-bound checks still use normalized landmarks. Changing between angle sources mid-cycle resets that cycle. Whole-body rise/fall is measured in image coordinates because world landmarks are hip-relative.

For a repetition:

1. Hold the starting extended position for at least 350 ms, with at least two frames.
2. Move away from the start through an observed intermediate joint angle. One intermediate sample per direction is sufficient; the engine also requires body travel and stationary supports.
3. Reach the other endpoint. There is no mandatory pause at the bottom or at the top of a pull-up.
4. Return through an observed intermediate angle to the original position. The full return counts without an extra endpoint hold.
5. The observed excursion must last at least 900 ms (1200 ms for a pull-up) and no longer than 15 seconds. A fast excursion cannot be made valid simply by waiting at the endpoint afterward.

Separate entry/exit thresholds provide hysteresis. Push-ups require elbow extension/flexion plus shoulder and hip descent; stationary wrists/ankles provide the reference. Squats require knee extension/flexion and hip descent, with a stable ankle reference. Pull-ups require both elbow angles, shoulder and hip rise, roughly upright torso, and fixed raised wrist locations. Large inter-frame jumps, changed supports, missing joints or frame gaps cancel incomplete cycles. Starting at the bent endpoint or making partial movements does not count.

Push-ups now allow more estimated-angle error; squats use tighter endpoints, as requested after phone use:

| Estimated angle gate | Previous | Current |
|---|---:|---:|
| Push-up extended elbow | ≥155° | ≥150° |
| Push-up bent elbow | ≤110° | ≤115° |
| Squat extended knee | ≥155° | ≥158° |
| Squat bent knee | ≤117° | ≤112° |

These are recognition thresholds, not exercise technique targets. Body-travel, support, visibility and duration requirements remain unchanged. The departure gate remains below 146° and the return-from-bottom gate above 119°. Intermediate samples must be above the exercise's bottom threshold (115° for push-ups, 112° for squats), so a held bottom cannot substitute for transit. An intermediate sample also needs at least 6° of flexion relative to the recorded starting angle. A complete return is still required, and endpoint jumps and shaking do not count. Other exercise thresholds are unchanged.

Synthetic regressions cover the newly accepted push-up endpoints (153° top / 114° bottom) and newly rejected squat endpoints (156° top or 116° bottom), in both image and world coordinates at 4 and 8 fps. They check algorithm behaviour, not physical-phone accuracy.

Departure timing uses the immediately preceding fresh transit sample when available; a long wait in the ready position is not included in the movement duration. Push-ups and plank measure body height above the projected wrist/ankle or elbow/ankle support line, allowing perspective to place the hands and feet at different image heights. Body-line, body-travel and support checks still apply.

These numeric thresholds are conservative prototype heuristics. They may reject real repetitions because of camera angle, body proportions, clothing, lighting or model error. They are not individualized biomechanics standards.

## Plank semantics

Both visible forearm support and visible straight-arm support are accepted when the broad body-line/support checks pass. The position must first remain eligible for 500 ms. After that only an interval bounded by two consecutive valid fresh frames is credited, using its actual duration up to 500 ms. A gap over 500 ms is never credited and requires establishing the position again.

An invalid frame, missing visibility, backgrounding, manual pause or stream gap resets readiness and `continuousHoldSeconds`. Previously accumulated `holdSeconds` is preserved. Consequently the default value means **total observed holding time**, not an uninterrupted 60-second plank. If the UI promises one unbroken hold, it must use `metrics.continuousHoldSeconds` for that goal instead. No duration is reconstructed from elapsed wall-clock time while the camera was missing.

## Limits, report wording and privacy

Use wording such as **«Посчитано камерой: 10 повторов»** and **«Планка: 60 секунд видимого удержания»**. The app uses free counting: the user explicitly finishes and saves the observed result, with no prescribed goal or automatic completion. A parent can receive a request for extra time with this result, but this algorithm does not authorize or grant screen time itself.

Pull-ups are explicitly approximate: it does not prove a chin crossed the bar, that the hands are really gripping a bar, that body weight is unsupported, or that the person did not jump or receive assistance. A pose-only pipeline also cannot reliably detect replayed video or a photo shown to the camera. The app must not present the result as tamper-proof proof or certified exercise form.

The module retains only a current/reference pose and small numeric counters in memory. It contains no storage, network calls, camera frames, biometrics or identity templates. Stop/dispose the camera in the host when finished; this module cannot release a stream it did not create.

## Verification

Run:

```powershell
& 'C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' scripts/test-pose-engine.mjs
```

The synthetic suite includes relaxed-angle positives in image and world coordinates, endpoint noise at 4/8 fps, just-outside-tolerance negatives, bottom jitter, endpoint-only jumps, incomplete returns, insufficient body travel and short excursions. It also covers full cycles at 3–8 fps without endpoint holds, 1.5–1.8 second movements, comfortable squat depths with world angles, consecutive repetitions, half cycles, endpoint shaking, wrong starting position, lack of body movement, moving wrists/feet, missing confidence, out-of-frame joints, side/source changes, frame gaps, duplicate timestamps, hidden document, aspect correction, world-coordinate gating, invalid plank poses, actual elapsed holding time, pause/reset and scoring deduplication. These tests validate deterministic logic only.

The bundled real MediaPipe model was also run locally against a continuous side-view push-up in a public-domain demonstration. The old engine counted zero; the corrected engine counted one full cycle, with no extra repetition. See `pushup-original-video-qa.json`. Replaying the saved real landmarks after the small angle-tolerance change still counts exactly one cycle at 8 fps and at downsampled 4 fps, using either world or image angles; the separate clip cut before a full return still counts zero. User-supplied photos and a recording of the phone screen confirm working pose overlay and a stalled squat count, but do not provide the raw landmarks/timestamps needed to replay that exact phone session. Physical-phone performance and general exercise counting accuracy remain unvalidated.

The camera pipeline reuses a canvas capped at 640 pixels on the longest side before inference. The UI's «Проверка счётчика» shows local version/device information, sample frequency, inference time, phase, rejection reason and joint angles. It does not save or transmit camera frames.

## Official data-format references

MediaPipe returns 33 landmarks, normalized x/y coordinates relative to image width/height, optional world coordinates in metres centred at the hips, and landmark visibility. See Google's [Web Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js) and [landmark index reference](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker). Reviewed 17 October 2026. All counting rules above are this application's own heuristics, not guarantees supplied by MediaPipe.
