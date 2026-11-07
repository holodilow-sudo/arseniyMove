"""Reproduce the selected public-domain 30-second clip; does not build an APK."""
from pathlib import Path
import hashlib, json, subprocess, urllib.request
ROOT = Path(__file__).resolve().parents[1]
INFO = json.loads((ROOT/'docs/pushup-video-source.json').read_text(encoding='utf-8'))
SOURCE = ROOT/'work/video-source/pushups-original.mp4'
SOURCE.parent.mkdir(parents=True, exist_ok=True)
if not SOURCE.exists():
    request = urllib.request.Request(INFO['publicPlaybackSource'], headers={'User-Agent':'Mozilla/5.0'})
    with urllib.request.urlopen(request, timeout=90) as response:
        SOURCE.write_bytes(response.read())
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == INFO['sourceSha256'], 'Source changed; review it before use'
FFMPEG = 'C:/Program Files/BlueStacks_nxt/ffmpeg.exe'
subprocess.run([FFMPEG,'-hide_banner','-loglevel','error','-ss','6','-i',str(SOURCE),'-t','30',
    '-vf','scale=960:540','-c:v','libopenh264','-profile:v','main','-pix_fmt','yuv420p','-b:v','900k',
    '-c:a','copy','-movflags','+faststart','-y',str(ROOT/'app/media/pushup-technique.mp4')], check=True)
subprocess.run([FFMPEG,'-hide_banner','-loglevel','error','-ss','17','-i',str(SOURCE),'-frames:v','1',
    '-vf','scale=960:540','-y',str(ROOT/'app/media/pushup-poster.jpg')], check=True)
print('30-second clip and poster ready. Original English audio; authored Russian VTT supplied separately.')
