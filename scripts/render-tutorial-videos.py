"""Render the reviewed instructional clips from local originals; never builds an APK.

Usage: python scripts/render-tutorial-videos.py --source-dir PATH
PATH contains exercise/original.mp4; boat uses boat/cdc-source.mp4.
Requires ffmpeg with libx264 and libass. Original hashes are pinned in the manifest.
"""
from pathlib import Path
import argparse, hashlib, json, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[1]

def timestamp(value):
    return f'{int(value//3600)}:{int(value%3600//60):02d}:{value%60:05.2f}'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((ROOT/'docs/tutorial-video-sources.json').read_text(encoding='utf-8'))
    for key, spec in manifest.items():
        original = args.source_dir/key/('cdc-source.mp4' if key=='boat' else 'original.mp4')
        if hashlib.sha256(original.read_bytes()).hexdigest() != spec['originalSha256']:
            raise ValueError(f'{key}: original changed; review it before rendering')
        with tempfile.TemporaryDirectory(prefix='arseniy-video-') as temp:
            ass = '''[Script Info]
ScriptType: v4.00+
PlayResX: 960
PlayResY: 660
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,36,&H00EAF5F7,&H00EAF5F7,&H00281E10,&H00281E10,-1,0,0,0,100,100,0,0,1,0,0,8,18,18,18,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
            for start, end, text in spec['cues']:
                ass += f'Dialogue: 0,{timestamp(start)},{timestamp(end)},Default,,0,0,0,,' + text.replace('\n','\\N') + '\n'
            (Path(temp)/'captions.ass').write_text(ass,encoding='utf-8')
            filters = ([f'crop={spec["crop"]}'] if spec['crop'] else []) + [
                'scale=960:540:flags=lanczos','setsar=1','pad=960:660:0:120:color=0x101e28','subtitles=captions.ass']
            output = ROOT/'app/media'/f'{key}-technique.mp4'
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(spec['start']),'-i',str(original.resolve()),
                '-t',str(spec['seconds']),'-map','0:v:0','-an','-vf',','.join(filters),'-r','30','-c:v','libx264',
                '-preset','fast','-crf','23','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart','-y',str(output)],cwd=temp,check=True)
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(spec['poster']),'-i',str(output),
                '-frames:v','1','-q:v','2','-y',str(ROOT/'app/media'/f'{key}-poster.jpg')],check=True)
            print(f'{key}: {spec["seconds"]} seconds, SHA-256 {hashlib.sha256(output.read_bytes()).hexdigest()}')

if __name__=='__main__': main()
