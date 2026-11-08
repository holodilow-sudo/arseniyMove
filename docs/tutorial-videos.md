# Local exercise instructions — review before APK build

Every exercise enters its own technique video, then camera setup. “Repeat technique” returns to the same exercise. Source audio is omitted from the five new clips; authored Russian captions are burned into an added band above the footage so native player controls do not cover them. The original push-up clip and its optional Russian subtitles are unchanged.

| Exercise | Duration | Original time | Adaptation |
| --- | --- | --- | --- |
| Squat | 12 s | 18–30 s | Full view |
| Plank | 12 s | 0–12 s | Enlarged lower side view |
| Pull-up | 16 s | 5.5–21.5 s | Enlarged upper oblique view |
| Superman / boat | 18 s | 31–49 s | CDC replacement, cropped letterbox |
| Dead hang | 12 s | 58–70 s | Full view, demonstration only |

No exercise motion is synthesized, looped, reversed or sped up. Frame rate is normalized to 30 fps. Files are local H.264/yuv420p MP4 with faststart, 960×660 including the caption band. This output size is not a claim about source detail: the CDC original is 320×240; the dead-hang source is 768×432; enlarged split-screen views have roughly 480–512 source pixels of width.

The initially suggested DVIDS “Prone Superman” (640241) was downloaded and rejected after visual review: it demonstrates alternating limbs rather than the app's bilateral hold. The replacement is CDC's “Muscle Strengthening at Home — Superman”, declared public domain on its Wikimedia Commons description page. Other four new sources are declared public domain on DVIDS. Attribution and the DVIDS non-endorsement notice appear under “About the video”; exact source URLs, hashes, cuts and captions are in `tutorial-video-sources.json`.

`scripts/render-tutorial-videos.py --source-dir PATH` reproduces the transformations from pinned local originals with FFmpeg/libass/libx264. It does not download files, build an APK or publish anything. The draft can be reviewed at `/preview/tutorial-videos.html` using `scripts/serve.py --port 8788`.

This preview has not been installed or tested on Arseniy's phone. The user approved the preview and authorized an APK build and GitHub draft release. Publication still requires separate approval.

## Preview playback fix

The desktop in-app browser displayed a black video surface inside the gallery iframe despite advancing playback time and reporting readyState 4 with no media error. The same app screen played visibly in the top-level document. The gallery entry now redirects to the actual app with a localhost-only review selector (`tutorialGallery=1`), removing the iframe. Verified visible frames and changing Russian captions at 5.8 seconds, plus exercise switching. Media files and Android playback are unchanged; no APK was built.
