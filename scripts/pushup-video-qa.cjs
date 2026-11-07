/* Actual local public-domain tutorial -> packaged MediaPipe -> movement tracker.
 * This does not open a camera and is not a substitute for physical-phone QA. */
const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const ROOT=path.resolve(__dirname,'..'),WORK=path.join(ROOT,'work/pushup-video-qa'),BASE='https://appassets.androidplatform.net/assets/app/';
fs.mkdirSync(WORK,{recursive:true});
const ORIGINAL=process.argv.includes('--original');
const START=ORIGINAL?32:0, END=ORIGINAL?42:30, FPS=8;
const baseline=path.join(WORK,'pose-engine-baseline.mjs');
if(!fs.existsSync(baseline))fs.copyFileSync(path.join(ROOT,'app/pose-engine.mjs'),baseline);
const CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'";
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.vtt':'text/vtt'};
const headers={'Content-Security-Policy':CSP,'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-cache'};
const assets=new Map();function inventory(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+entry.name,file=path.join(dir,entry.name);if(entry.isDirectory())inventory(file,name+'/');else assets.set(name,file);}}inventory(path.join(ROOT,'app'));
if(ORIGINAL)assets.set('media/pushup-original-local.mp4',path.join(ROOT,'work/video-source/pushups-original.mp4'));
function summarize(createTracker,frames,{world=true,cadence=125}={}){const tracker=createTracker({exercise:'pushup'}),reasons={},phases={},trace=[],countEvents=[];let old=0;for(let i=0;i<frames.length;i++){const f=frames[i],input={...f,timestamp:1000+i*cadence,worldLandmarks:world?f.worldLandmarks:[]};const r=tracker.update(input),reason=r.metrics.reason||'valid';reasons[reason]=(reasons[reason]||0)+1;phases[r.metrics.repStage||r.phase]=(phases[r.metrics.repStage||r.phase]||0)+1;if(r.count>old){countEvents.push(f.time);old=r.count;}trace.push({t:f.time,count:r.count,tracking:r.tracking,reason,phase:r.metrics.repStage,side:r.metrics.side,source:r.metrics.source,elbow:r.metrics.elbowAngle,hip:r.metrics.hipAngle,line:r.metrics.bodyLineAngle,knee:r.metrics.kneeAngle,confidence:r.metrics.confidence});}return {count:old,countEvents,reasons,phases,trace};}
(async()=>{let browser;const report={checkedAt:new Date().toISOString(),realCameraAccessed:false,physicalPhoneTested:false,source:ORIGINAL?'work/video-source/pushups-original.mp4':'app/media/pushup-technique.mp4', interval:[START,END],sourceNote:ORIGINAL?'Public-domain DVIDS push-up demonstration; locally sampled32–42s original, includes one uninterrupted side-view repetition.':'Public-domain DVIDS push-up demonstration, local30-second excerpt; camera-angle cuts interrupt tracking.'};
try{
 let frames;
 const frameFile=path.join(WORK,ORIGINAL?'landmarks-original-32-42.json':'landmarks-v2.json');
 if(fs.existsSync(frameFile)){frames=JSON.parse(fs.readFileSync(frameFile,'utf8'));report.reusedLandmarks=true;}
 else{
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:960,height:640}});
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(!u.href.startsWith(BASE))return route.abort();const name=decodeURIComponent(u.pathname.slice('/assets/app/'.length));if(name==='video-qa.html')return route.fulfill({headers:{...headers,'Content-Type':'text/html'},body:'<!doctype html><html><body style="margin:0;background:#111"><video id="video" muted playsinline style="width:960px;height:540px"></video></body></html>'});if(!assets.has(name))return route.fulfill({status:404,body:'Missing exact asset'});const file=assets.get(name);return route.fulfill({headers:{...headers,'Content-Type':types[path.extname(file)]||'application/octet-stream'},body:fs.readFileSync(file)});});
  const page=await context.newPage();page.on('console',message=>{if(message.text().startsWith('VIDEO-QA'))console.log(message.text());});await page.goto(BASE+'video-qa.html');
  await page.evaluate(async original=>{
   const video=document.querySelector('#video');const bytes=await fetch(new URL(original?'media/pushup-original-local.mp4':'media/pushup-technique.mp4',location.href)).then(r=>r.blob());video.src=URL.createObjectURL(bytes);video.load();await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error(video.error?.message||'Video failed'));});
   const {FilesetResolver,PoseLandmarker}=await import('./vendor/vision_bundle.mjs');const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',location.href).href);
   window.detector=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/pose_landmarker_lite.task',location.href).href,delegate:'CPU'},runningMode:'VIDEO',numPoses:2,minPoseDetectionConfidence:.65,minPosePresenceConfidence:.65,minTrackingConfidence:.65});
   window.videoInfo={duration:video.duration,width:video.videoWidth,height:video.videoHeight};window.seekVideo=time=>new Promise((resolve,reject)=>{if(Math.abs(video.currentTime-time)<.0001&&video.readyState>=2)return resolve();const timer=setTimeout(()=>reject(new Error('Seek timeout '+time)),10000);video.onseeked=()=>{clearTimeout(timer);if(Math.abs(video.currentTime-time)>.06)return reject(new Error('Seek did not reach requested frame'));requestAnimationFrame(()=>requestAnimationFrame(resolve));};video.currentTime=time;});
   window.inferenceCanvas=document.createElement('canvas');inferenceCanvas.width=640;inferenceCanvas.height=Math.round(640*video.videoHeight/video.videoWidth);window.inferenceCtx=inferenceCanvas.getContext('2d');
  },ORIGINAL);
  report.video=await page.evaluate(()=>videoInfo);frames=[];
  for(let batch=0;batch<Math.ceil((END-START)*FPS/60);batch++){
   const data=await page.evaluate(async ({batch,start,end,fps,original})=>{const video=document.querySelector('#video'),out=[];for(let i=batch*60;i<Math.min((batch+1)*60,Math.floor((end-start)*fps));i++){const time=start+i/fps;await seekVideo(time);if(original)inferenceCtx.drawImage(video,0,0,inferenceCanvas.width,inferenceCanvas.height);const t=performance.now(),r=detector.detectForVideo(original?inferenceCanvas:video,1000+i*125),multiplePeople=r.landmarks.length>1;out.push({time,latencyMs:Math.round((performance.now()-t)*10)/10,poseCount:r.landmarks.length,multiplePeople,aspectRatio:video.videoWidth/video.videoHeight,landmarks:multiplePeople?[]:r.landmarks[0]||[],worldLandmarks:multiplePeople?[]:r.worldLandmarks[0]||[]});}console.log('VIDEO-QA batch '+batch+' frames '+out.length);return out;},{batch,start:START,end:END,fps:FPS,original:ORIGINAL});frames.push(...data);
  }
  const distinct=new Set(frames.map(f=>JSON.stringify(f.landmarks)));if(distinct.size<20)throw new Error('Video fixture does not contain enough distinct decoded poses: '+distinct.size);
  fs.writeFileSync(frameFile,JSON.stringify(frames));await page.evaluate(()=>detector.close());
  for(const time of (ORIGINAL?[32,33,34,35,36,37,38,39,40,41]:[2,8,14,20,26])){await page.evaluate(time=>seekVideo(time),time);await page.locator('#video').screenshot({path:path.join(WORK,`${ORIGINAL?'full':'frame'}-${time}.png`)});}
 }
 const {createTracker:before}=await import(pathToFileURL(baseline).href),{createTracker:current}=await import(pathToFileURL(path.join(ROOT,'app/pose-engine.mjs')).href);
 report.baselineHash=crypto.createHash('sha256').update(fs.readFileSync(baseline)).digest('hex');report.currentHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'app/pose-engine.mjs'))).digest('hex');
 report.frames=frames.length;report.detected=frames.filter(f=>f.poseCount===1).length;report.multiple=frames.filter(f=>f.multiplePeople).length;report.meanInferenceMs=frames.reduce((s,f)=>s+f.latencyMs,0)/frames.length;
 report.baselineWorld=summarize(before,frames);report.baselineImage=summarize(before,frames,{world:false});report.currentWorld=summarize(current,frames);report.currentImage=summarize(current,frames,{world:false});report.currentSlow300ms=summarize(current,frames,{cadence:300});report.current4fps=summarize(current,frames.filter((f,i)=>i%2===0),{cadence:250});
 fs.writeFileSync(path.join(WORK,ORIGINAL?'trace-original-32-42.json':'trace.json'),JSON.stringify(report));
 for(const name of ['baselineWorld','baselineImage','currentWorld','currentImage','currentSlow300ms','current4fps'])delete report[name].trace;
 fs.writeFileSync(path.join(ROOT,ORIGINAL?'docs/pushup-original-video-qa.json':'docs/pushup-video-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){console.error(error);process.exitCode=1;}finally{if(browser)await browser.close();}})();
