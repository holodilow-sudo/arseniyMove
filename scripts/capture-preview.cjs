const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'preview'),SHOTS=path.join(OUT,'screens'),FRAMES=path.join(OUT,'frames');
fs.mkdirSync(SHOTS,{recursive:true});fs.mkdirSync(FRAMES,{recursive:true});
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});const page=await context.newPage();await page.goto('http://127.0.0.1:4187/app/?preview=1');await page.waitForFunction(()=>window.MovePreview);
for(const scene of ['home','tutorial','setup','workout','result','request','request-report','progress','settings']){
  await page.evaluate(()=>localStorage.removeItem('arseniy-move-preview-v1'));
  await page.goto('http://127.0.0.1:4187/app/?preview=1&screen='+scene);await page.waitForFunction(()=>window.MovePreview);await page.waitForTimeout(900);
  await page.screenshot({path:path.join(SHOTS,scene+'.png'),fullPage:true,style:'.bottom-nav{position:absolute!important;bottom:0!important}'});
  await page.screenshot({path:path.join(SHOTS,scene+'-phone.png')});
}
await page.evaluate(()=>MovePreview.show('result'));await page.waitForTimeout(30);
for(let i=0;i<28;i++){await page.evaluate(ms=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=ms}),i*100);await page.screenshot({path:path.join(FRAMES,`reward-${String(i).padStart(3,'0')}.png`)});}
await page.evaluate(()=>MovePreview.show('workout'));await page.waitForTimeout(30);
for(let i=0;i<24;i++){await page.evaluate(ms=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=ms}),i*100);await page.screenshot({path:path.join(FRAMES,`camera-${String(i).padStart(3,'0')}.png`)});}
const audio=await page.evaluate(async()=>{const b=await MovePreview.sounds();return {sampleRate:b.sampleRate,pcm:Array.from(b.getChannelData(0))}});
const wav=Buffer.alloc(44+audio.pcm.length*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(audio.sampleRate,24);wav.writeUInt32LE(audio.sampleRate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);audio.pcm.forEach((v,i)=>wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));fs.writeFileSync(path.join(OUT,'sounds.wav'),wav);
await browser.close();console.log('9 screens + phone views, 52 animation frames, local audio demo');})();
