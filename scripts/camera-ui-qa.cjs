/* Native-bridge and camera mocks test UI state only; no webcam is opened. */
const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE='https://appassets.androidplatform.net/assets/app/';
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.vtt':'text/vtt'};
const CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const headers={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':CSP};
const mockCamera=`export class VisionCamera {async start(options){window.__cameraOptions=options;window.__cameraCalls.push(options.facing);if(window.__cameraFail){options.onError('Не удалось получить изображение. Закрой другие приложения с камерой и проверь переключатель «Доступ к камере» в Android.',{code:'NotReadableError',stage:'capture'});}else{options.onPreview({facing:options.facing});options.onStatus('Встань целиком в кадр');}}stop(){window.__cameraStops=(window.__cameraStops||0)+1;}}`;
function fixture(){
 window.__cameraCalls=[];window.__cameraFail=true;
 const caps={available:true,appVersion:'1.0.2',cameraPermission:true,cameraPermissionState:'granted',nativeCameraPermission:true,permissionPromptActive:false,openAppSettings:true,manufacturer:'TestMaker',model:'TestPhone123',androidVersion:'13',webViewVersion:'123.0.0.0',reminder:{enabled:true,time:'07:00',days:[1,2,3,4,5,6,7],status:'current',active:true,notificationPermission:true,notificationsAvailable:true}};
 window.MoveNative={getCapabilities:()=>JSON.stringify(caps),openAppSettings:()=>window.__settingsOpened=true};
 if(!localStorage.getItem('arseniy-move-v1'))localStorage.setItem('arseniy-move-v1',JSON.stringify({version:1,plan:{pushup:10,squat:20,plank:60,pullup:1},sound:false,history:[{id:'existing-result',exercise:'pushup',actual:10,goal:10,source:'camera-estimate',trackedFrames:100,endedAt:'2026-10-15T12:00:00Z'}],coins:20,xp:50,owned:['lime'],theme:'lime'}));
}
function oneSquat(){
 const p=(x,y)=>({x,y,z:0,visibility:.99,presence:.99});
 const pose=a=>{const result=Array.from({length:33},()=>({...p(.5,.5),visibility:0,presence:0}));const joints={shoulder:p(.60-.13*a,.22+.12*a),hip:p(.60-.10*a,.50+.14*a),knee:p(.60+.10*a,.70+.02*a),ankle:p(.60,.90),elbow:p(.55,.40),wrist:p(.49,.50)};for(const [right,map]of [[false,{shoulder:11,elbow:13,wrist:15,hip:23,knee:25,ankle:27}],[true,{shoulder:12,elbow:14,wrist:16,hip:24,knee:26,ankle:28}]])for(const [name,index]of Object.entries(map))result[index]={...joints[name],x:joints[name].x+(right?.012:0),visibility:right?.96:.99};return result;};
 let t=window.__testFrameTime||0;const frame=a=>{window.__cameraOptions.onResult({landmarks:pose(a),timestamp:t,aspectRatio:1,multiplePeople:false});t+=50;};
 const hold=(a,n)=>{for(let i=0;i<=n;i++)frame(a);};hold(0,10);for(let i=1;i<=18;i++)frame(i/18);hold(1,6);for(let i=1;i<=18;i++)frame(1-i/18);hold(0,7);window.__testFrameTime=t;
}
(async()=>{
 let browser;const checks=[],errors=[],shots=[];const check=(name,value)=>{assert.ok(value,name);checks.push({name,passed:true});};
 const report={checkedAt:new Date().toISOString(),physicalPhoneTested:false,realCameraAccessed:false,nativePermissionDialogTested:false,mocks:['MoveNative capabilities/settings','VisionCamera start/stop/capture failure; real UI and pose tracker'],screenshots:shots};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of [390,360]){
   const context=await browser.newContext({viewport:{width,height:844}});await context.addInitScript(fixture);
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(!u.href.startsWith(BASE))return route.abort();if(u.pathname.endsWith('/camera.mjs'))return route.fulfill({headers:{...headers,'Content-Type':'text/javascript'},body:mockCamera});const target=path.resolve(ROOT,'app',decodeURIComponent(u.pathname.slice('/assets/app/'.length)));if(!target.startsWith(path.join(ROOT,'app')+path.sep)||!fs.existsSync(target))return route.fulfill({status:404,body:'Missing asset'});return route.fulfill({headers:{...headers,'Content-Type':types[path.extname(target)]||'application/octet-stream'},body:fs.readFileSync(target)});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'index.html');await page.locator('[data-action="exercise"][data-exercise="squat"]').click();
   check(`${width}: front camera selected by default`,await page.locator('[data-facing="user"]').getAttribute('aria-pressed')==='true');
   await page.locator('[data-facing="environment"]').click();await page.reload();await page.locator('[data-action="exercise"][data-exercise="squat"]').click();
   check(`${width}: rear camera selection persists reload`,await page.locator('[data-facing="environment"]').getAttribute('aria-pressed')==='true');
   await page.locator('[data-facing="user"]').click();
   check(`${width}: setup has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const setup=path.join(ROOT,'preview/screens',`camera-setup-102-${width}.png`);await page.screenshot({path:setup,fullPage:true,animations:'disabled'});shots.push(setup);
   await page.locator('[data-action="start"]').click();await page.locator('#camera-error details').click();
   const diagnostic=await page.locator('#camera-error-code').innerText();
   check(`${width}: capture error identifies version, phone, Android, WebView and stage`,['Arseniy Move 1.0.2','TestMaker TestPhone123','Android 13','WebView 123.0.0.0','capture / NotReadableError','Доступ: разрешён'].every(text=>diagnostic.includes(text)));
   check(`${width}: failed capture gives no progress or rewards`,await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('arseniy-move-v1'));return s.history.length===1&&s.coins===20&&s.xp===50&&document.querySelector('#count-value').textContent==='0';}));
   check(`${width}: error panel has no horizontal overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const error=path.join(ROOT,'preview/screens',`camera-error-102-${width}.png`);await page.screenshot({path:error,fullPage:true,animations:'disabled'});shots.push(error);
   await page.evaluate(()=>window.__cameraFail=false);await page.locator('[data-action="switch-camera"]').click();
   check(`${width}: camera recovery uses back camera and clears error`,await page.evaluate(()=>window.__cameraCalls.join(',')==='user,environment'&&document.querySelector('#camera-error').classList.contains('hidden')&&document.querySelector('.camera-stage').classList.contains('rear-camera')));
   await page.evaluate(oneSquat);check(`${width}: existing tracker counts one full synthetic squat`,await page.locator('#count-value').innerText()==='1');
   await page.evaluate(()=>window.__cameraOptions.onError('Камера прервалась.',{code:'TRACK_ENDED',stage:'capture'}));await page.locator('[data-action="switch-camera"]').click();
   check(`${width}: switch keeps unfinished session count immediately`,await page.locator('#count-value').innerText()==='1');
   check(`${width}: switch preserves unfinished session progress bar`,await page.locator('#session-progress').evaluate(el=>el.style.width==='5%'));
   await page.locator('[data-action="stop"]').click();await page.locator('[data-action="confirm-stop"]').click();await page.locator('[data-action="nav"][data-screen="settings"]').click();
   const issue=page.locator('.panel').filter({has:page.getByRole('heading',{name:'Последняя проверка камеры'})});await issue.locator('summary').click();check(`${width}: settings retains latest issue`,await issue.innerText().then(t=>t.includes('Камера прервалась.')&&t.includes('TRACK_ENDED')));
   await page.reload();await page.locator('[data-action="nav"][data-screen="settings"]').click();await page.locator('.camera-error summary').click();check(`${width}: latest diagnostic persists reload`,await page.locator('.camera-error').innerText().then(t=>t.includes('TRACK_ENDED')));
   check(`${width}: prior completed training and rewards preserved`,await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('arseniy-move-v1'));return s.history[0]?.id==='existing-result'&&s.history.length===1&&s.coins===20&&s.xp===50;}));
   await context.close();
  }
  check('No unhandled JavaScript errors',errors.length===0);report.passed=true;
 }catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
 finally{if(browser)await browser.close();Object.assign(report,{checks,errors});fs.writeFileSync(path.join(ROOT,'docs/camera-ui-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
