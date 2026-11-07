/* Native-bridge and camera mocks test UI state only; no webcam is opened. */
const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE='https://appassets.androidplatform.net/assets/app/';
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.vtt':'text/vtt'};
const CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const headers={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':CSP};
const mockCamera=`export class VisionCamera {async start(options){window.__cameraOptions=options;window.__cameraCalls.push(options.facing);if(window.__cameraFail){options.onError('Не удалось получить изображение. Закрой другие приложения с камерой и проверь переключатель «Доступ к камере» в Android.',{code:'NotReadableError',stage:'capture'});}else{options.onPreview({facing:options.facing});options.onStatus('Встань целиком в кадр');}}stop(){window.__cameraStops=(window.__cameraStops||0)+1;}}`;
function fixture(){
 window.__cameraCalls=[];window.__cameraFail=false;
 const caps={available:true,appVersion:'1.0.3',cameraPermission:true,cameraPermissionState:'granted',nativeCameraPermission:true,permissionPromptActive:false,openAppSettings:true,manufacturer:'TestMaker',model:'TestPhone123',androidVersion:'13',webViewVersion:'123.0.0.0',reminder:{enabled:true,time:'07:00',days:[1,2,3,4,5,6,7],status:'current',active:true,notificationPermission:true,notificationsAvailable:true}};
 window.MoveNative={getCapabilities:()=>JSON.stringify(caps),openAppSettings:()=>window.__settingsOpened=true};
 if(!localStorage.getItem('arseniy-move-v1'))localStorage.setItem('arseniy-move-v1',JSON.stringify({version:1,plan:{pushup:10,squat:20,plank:60,pullup:1},sound:false,history:[{id:'existing-result',exercise:'pushup',actual:10,goal:10,source:'camera-estimate',trackedFrames:100,endedAt:'2026-10-15T12:00:00Z'}],coins:20,xp:50,owned:['lime'],theme:'lime'}));
}
function trackingFixture(){
 const p=(x,y)=>({x,y,z:0,visibility:.99,presence:.99});
 window.__pose=a=>{const out=Array.from({length:33},()=>({...p(.5,.5),visibility:0,presence:0}));const joints={shoulder:p(.60-.13*a,.22+.12*a),hip:p(.60-.10*a,.50+.14*a),knee:p(.60+.10*a,.70+.02*a),ankle:p(.60,.90),elbow:p(.55,.40),wrist:p(.49,.50)};for(const [right,map]of [[false,{shoulder:11,elbow:13,wrist:15,hip:23,knee:25,ankle:27}],[true,{shoulder:12,elbow:14,wrist:16,hip:24,knee:26,ankle:28}]])for(const [name,index]of Object.entries(map))out[index]={...joints[name],x:joints[name].x+(right?.012:0),visibility:right?.96:.99};return out;};
 window.__time=0;
 window.__emit=a=>{
  const landmarks=a===null?[]:window.__pose(a);
  window.__cameraOptions.onResult({landmarks,timestamp:window.__time,aspectRatio:1,multiplePeople:false,inferenceMs:275,inputWidth:640,inputHeight:640});window.__time+=250;
  const c=document.querySelector('#pose-overlay');if(c){c.width=c.height=640;const ctx=c.getContext('2d');ctx.clearRect(0,0,640,640);ctx.strokeStyle='#d7ff5f';ctx.lineWidth=4;for(const [a,b]of[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]]){if(!landmarks[a]||!landmarks[b])continue;ctx.beginPath();ctx.moveTo(landmarks[a].x*640,landmarks[a].y*640);ctx.lineTo(landmarks[b].x*640,landmarks[b].y*640);ctx.stroke();}}
 };
 window.__hold=()=>{for(let i=0;i<4;i++)window.__emit(0);};
 window.__rep=()=>{window.__hold();for(let i=1;i<=8;i++)window.__emit((1-Math.cos(2*Math.PI*i/8))/2);};
}
(async()=>{
 let browser;const checks=[],errors=[],screenshots=[];const check=(name,passed)=>{assert.ok(passed,name);checks.push({name,passed:true});};
 const report={checkedAt:new Date().toISOString(),physicalPhoneTested:false,realCameraAccessed:false,syntheticOnly:true,fixture:'Mock camera capture with constructed 4 fps landmarks; real production UI and pose-engine. This is not exercise accuracy validation.'};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of[390,360]){
   const context=await browser.newContext({viewport:{width,height:844}});await context.addInitScript(fixture);await context.addInitScript(trackingFixture);
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(!u.href.startsWith(BASE))return route.abort();if(u.pathname.endsWith('/camera.mjs'))return route.fulfill({headers:{...headers,'Content-Type':'text/javascript'},body:mockCamera});const target=path.resolve(ROOT,'app',decodeURIComponent(u.pathname.slice('/assets/app/'.length)));if(!target.startsWith(path.join(ROOT,'app')+path.sep)||!fs.existsSync(target))return route.fulfill({status:404,body:'Missing asset'});return route.fulfill({headers:{...headers,'Content-Type':types[path.extname(target)]||'application/octet-stream'},body:fs.readFileSync(target)});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'index.html');
   await page.locator('[data-action="exercise"][data-exercise="squat"]').click();await page.locator('[data-action="start"]').click();
   await page.evaluate(()=>{for(let i=0;i<20;i++)window.__emit(null);});
   check(width+': blank frames give no count or reward',await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('arseniy-move-v1'));return document.querySelector('#count-value').textContent==='0'&&s.history.length===1&&s.xp===50&&s.coins===20;}));
   await page.evaluate(()=>window.__rep());check(width+': one continuous 4 fps squat without bottom hold counts once',await page.locator('#count-value').innerText()==='1');
   await page.locator('#tracking-check summary').click();const diagnostic=await page.locator('#tracking-check-data').innerText();
   check(width+': diagnostic identifies build, 4 fps, capture duration and phase',diagnostic.includes('Arseniy Move 1.0.3')&&diagnostic.includes('Кадров/с: 4.0')&&diagnostic.includes('Обработка кадра: 275 мс')&&diagnostic.includes('tracking / start')&&!/NaN|undefined/.test(diagnostic));
   check(width+': visible phase says ready',await page.locator('#tracking-state').textContent()==='Готов');
   check(width+': camera and overlay show full uncropped frame',await page.evaluate(()=>['#camera-video','#pose-overlay'].every(s=>getComputedStyle(document.querySelector(s)).objectFit==='contain')));
   check(width+': diagnostic has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.evaluate(()=>{document.querySelector('.camera-top').lastChild.textContent=' СИНТЕТИЧЕСКИЙ ТЕСТ · 4 КАДРА/С';});
   const shot=path.join(ROOT,'preview/screens',`tracking-103-${width}.png`);await page.screenshot({path:shot,fullPage:true,animations:'disabled'});screenshots.push(shot);
   await page.evaluate(()=>{window.__hold();for(let i=1;i<=4;i++)window.__emit((1-Math.cos(2*Math.PI*i/8))/2);});
   await page.locator('#pause-button').click();await page.evaluate(()=>{window.__emit(0);});check(width+': paused frame does not count',await page.locator('#count-value').innerText()==='1');
   await page.locator('#pause-button').click();await page.evaluate(()=>{for(let i=5;i<=8;i++)window.__emit((1-Math.cos(2*Math.PI*i/8))/2);window.__hold();});
   check(width+': pause and resume never bridge an unfinished repetition',await page.locator('#count-value').innerText()==='1');
   await page.evaluate(()=>{for(let i=0;i<19;i++)window.__rep();});await page.getByRole('heading',{name:'Есть результат!'}).waitFor();
   check(width+': full goal saves 20 counted repetitions and one reward',await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('arseniy-move-v1'));return s.history.length===2&&s.history[0].id==='existing-result'&&s.history[1].actual===20&&s.history[1].goal===20&&s.history[1].algorithmVersion===2&&s.xp===100&&s.coins===40;}));
   await page.evaluate(()=>{for(let i=0;i<8;i++)window.__rep();});
   check(width+': late frames after completion cannot duplicate rewards',await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('arseniy-move-v1'));return s.history.length===2&&s.xp===100&&s.coins===40;}));
   await page.reload();check(width+': old and new history survive reload',await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('arseniy-move-v1'));return s.history.length===2&&s.history[0].id==='existing-result'&&s.history[1].actual===20&&s.coins===40&&s.xp===100;}));
   await context.close();
  }
  check('No unhandled JavaScript errors',errors.length===0);report.passed=true;
 }catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
 finally{await browser?.close();Object.assign(report,{checks,errors,screenshots});fs.writeFileSync(path.join(ROOT,'docs/tracking-ui-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
