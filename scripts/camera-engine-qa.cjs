/* Real packaged MediaPipe + synthetic video. No webcam, emulator or network. */
const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE='https://appassets.androidplatform.net/assets/app/';
const CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.vtt':'text/vtt'};
const headers={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':CSP};
// Treat packaged paths as exact ZIP entries. Do not let path.resolve silently
// repair a doubled slash: that previously hid a broken FilesetResolver base URL.
const assets=new Map();
function inventory(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+entry.name,file=path.join(dir,entry.name);if(entry.isDirectory())inventory(file,name+'/');else assets.set(name,file);}}
inventory(path.join(ROOT,'app'));
(async()=>{
 const results=[],errors=[],requests=[],rejectedAssets=[];let browser;
 const report={checkedAt:new Date().toISOString(),realCameraAccessed:false,deviceInstalled:false,networkAccessed:false,fixture:'Synthetic canvas stream; exact case-sensitive APK-style asset inventory, canonical paths, native HTTPS origin and CSP. Legacy fixtures restore only the 1.0.1 trailing-slash resolver URL and emulate strict lookup before native canonicalization.'};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});report.chromium=browser.version();
  for(const mode of ['worker','main-thread-fallback','worker-hd','main-thread-fallback-hd','legacy-worker','legacy-main-thread-fallback']){
  const legacy=mode.startsWith('legacy-');
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());requests.push({mode,url:u.href});
   if(!u.href.startsWith(BASE))return route.abort();
   const name=decodeURIComponent(u.pathname.slice('/assets/app/'.length));
   if(name.split('/').some(part=>!part||part==='.'||part==='..')||!assets.has(name)){
    rejectedAssets.push({mode,name});return route.fulfill({status:404,headers:{...headers,'Content-Type':'text/plain'},body:'No exact asset entry'});
   }
   const target=assets.get(name);let body=fs.readFileSync(target);
   if(legacy&&['camera.mjs','vision-worker.mjs'].includes(name)){
    const source=body.toString('utf8');assert.ok(source.includes("new URL('./vendor/wasm',"),'Expected fixed base in '+name);
    body=Buffer.from(source.replaceAll("new URL('./vendor/wasm',","new URL('./vendor/wasm/',"));
   }
   return route.fulfill({status:200,headers:{...headers,'Content-Type':types[path.extname(target)]||'application/octet-stream'},body});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push({mode,message:e.message}));
  await page.goto(BASE+'index.html');await page.waitForSelector('.workout-grid');
   const result=await page.evaluate(async mode=>{
    const {VisionCamera}=await import('./camera.mjs');
    const canvas=document.createElement('canvas');canvas.width=mode.endsWith('-hd')?1920:640;canvas.height=mode.endsWith('-hd')?1080:480;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#333';ctx.fillRect(0,0,canvas.width,canvas.height);
    const stream=canvas.captureStream(10),media=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async()=>stream;
    const video=document.createElement('video');video.muted=true;video.autoplay=true;video.playsInline=true;document.body.append(video);
    const overlay=document.createElement('canvas');document.body.append(overlay);
    const camera=new VisionCamera(),events=[];let settle,timer,frame=0;
    if(mode.includes('main-thread-fallback'))camera.initWorker=async()=>{throw new Error('Forced module-worker incompatibility');};
    const outcome=new Promise(resolve=>{settle=resolve;timer=setTimeout(()=>resolve({status:'timeout',events}),70000);});
    const drawing=setInterval(()=>{ctx.fillStyle=(frame++%2)?'#333':'#444';ctx.fillRect(0,0,canvas.width,canvas.height);},100);
    camera.start({video,canvas:overlay,onResult:result=>settle({status:'result',poses:result.landmarks.length,multiplePeople:result.multiplePeople,inputWidth:result.inputWidth,inputHeight:result.inputHeight,aspectRatio:result.aspectRatio,inferenceMs:result.inferenceMs,events}),onPreview:()=>events.push('preview'),onStatus:s=>events.push(s),onError:(message,details)=>settle({status:'error',message,details,events})});
    const result=await outcome;clearTimeout(timer);clearInterval(drawing);camera.stop();video.remove();overlay.remove();navigator.mediaDevices.getUserMedia=media;
    result.tracksEnded=stream.getTracks().every(track=>track.readyState==='ended');return result;
   },mode);
   console.log(JSON.stringify({mode,...result}));results.push({mode,...result});
   if(legacy){
    assert.equal(result.status,'error',`${mode}: broken resolver base must fail strict lookup`);assert.equal(result.details.stage,'model');
    assert.ok(rejectedAssets.some(a=>a.mode===mode&&a.name.includes('wasm//')),'Legacy fixture exposes doubled separator');
   }else{
    assert.equal(result.status,'result',`${mode}: ${JSON.stringify(result)}`);assert.equal(result.poses,0);assert.equal(result.multiplePeople,false);
    assert.equal(result.inputWidth,640);assert.equal(result.inputHeight,mode.endsWith('-hd')?360:480);assert.equal(result.aspectRatio,result.inputWidth/result.inputHeight);assert.ok(Number.isFinite(result.inferenceMs)&&result.inferenceMs>=0,'Inference duration is reported');
    assert.equal(rejectedAssets.filter(a=>a.mode===mode).length,0,'Fixed resolver uses only exact packaged asset entries');
   }
   assert.ok(result.events.includes('preview'));assert.equal(result.tracksEnded,true);await context.close();
  }
  assert.equal(errors.length,0,'No unhandled browser errors');assert.ok(requests.every(r=>r.url.startsWith(BASE)),'No external resource request');report.passed=true;
 }catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
 finally{if(browser)await browser.close();Object.assign(report,{results,errors,requests,rejectedAssets});fs.writeFileSync(path.join(ROOT,'docs/camera-engine-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
