from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1]/'preview'
for name in ['reward','camera']:
    frames=[Image.open(p).convert('RGB') for p in sorted((ROOT/'frames').glob(name+'-*.png'))]
    frames[0].save(ROOT/(name+'-animation.gif'),save_all=True,append_images=frames[1:],duration=100,loop=0,optimize=True)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',26)
scenes=[('home','01 / ТРЕНИРОВКА'),('workout','02 / КАМЕРА · ДЕМО'),('result','03 / НАГРАДА'),('request-report','04 / ОТЧЁТ ПАПЕ')]
canvas=Image.new('RGB',(4*390+5*24,920),'#09121a');draw=ImageDraw.Draw(canvas)
for i,(name,title) in enumerate(scenes):
    x=24+i*414;draw.text((x,20),title,font=font,fill='#d7ff5f');im=Image.open(ROOT/'screens'/(name+'-phone.png')).convert('RGB');canvas.paste(im,(x,60))
canvas.save(ROOT/'overview.png')
print('Preview animations and overview ready')
