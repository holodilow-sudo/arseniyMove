/* Native-bridge and camera mocks test UI state only; no webcam is opened. */
const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE='https://appassets.androidplatform.net/assets/app/';
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.vtt':'text/vtt'};
const CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const headers={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':CSP};
const mockCamera=`export class VisionCamera {async start(options){window.__cameraOptions=options;window.__cameraCalls.push(options.facing);if(window.__cameraFail){options.onError('Не удалось получить изображение. Закрой другие приложения с камерой и проверь переключатель «Доступ к камере» в Android.',{code:'NotReadableError',stage:'capture'});}else{options.onPreview({facing:options.facing});options.onStatus('Встань целиком в кадр');}}stop(){window.__cameraStops=(window.__cameraStops||0)+1;}}`;
function fixture(){
 window.__cameraCalls=[];window.__cameraFail=false;window.__shares=[];window.__drawnText=[];window.__time=0;window.__exercise='squat';
 const reminder={enabled:false,time:'08:20',days:[1,3,5],status:'current',active:false,notificationPermission:true,notificationsAvailable:true};
 const caps={available:true,appVersion:'1.0.14',cameraPermission:true,cameraPermissionState:'granted',nativeCameraPermission:true,permissionPromptActive:false,openAppSettings:true,manufacturer:'TestMaker',model:'TestPhone123',androidVersion:'13',webViewVersion:'123.0.0.0',reminder};
 window.MoveNative={getCapabilities:()=>JSON.stringify(caps),openAppSettings:()=>{}};
 window.AndroidShare={shareImage:(data,id)=>window.__shares.push({data,id})};
 const fill=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.__drawnText.push(String(text));return fill.call(this,text,...args);};
 if(!localStorage.getItem('arseniy-move-v1')){
  const history=Array.from({length:5},(_,i)=>({id:'legacy-'+i,exercise:'pushup',actual:10,goal:10,source:'camera-estimate',trackedFrames:100,endedAt:`2026-09-${20+i}T12:00:00Z`}));
  localStorage.setItem('arseniy-move-v1',JSON.stringify({version:1,plan:{pushup:10,squat:20,plank:60,pullup:1},sound:false,history,coins:20,xp:250,owned:['lime','orange'],theme:'orange',reminder}));
 }
 window.__state=()=>JSON.parse(localStorage.getItem('arseniy-move-v1'));
 window.__emit=(amount,step=250)=>{
  const landmarks=amount===null?[]:window.__poses[window.__exercise](amount);
  window.__cameraOptions.onResult({landmarks,timestamp:window.__time,aspectRatio:1,multiplePeople:false,inferenceMs:275,inputWidth:640,inputHeight:640});window.__time+=step;
 };
 window.__hold=()=>{for(let i=0;i<4;i++)window.__emit(0);};
 window.__rep=()=>{window.__hold();const samples=window.__exercise==='pullup'?10:8;for(let i=1;i<=samples;i++)window.__emit((1-Math.cos(2*Math.PI*i/samples))/2);};
}
const poseSource=fs.readFileSync(path.join(ROOT,'scripts/test-pose-engine.mjs'),'utf8');
const poseFixture='(()=>{'+poseSource.slice(poseSource.indexOf('const sides='),poseSource.indexOf('function harness('))+'window.__poses=poses;})();';
async function start(page,exercise){
 await page.evaluate(id=>{window.__exercise=id;window.__time=0;},exercise);
 await page.locator(`[data-action="exercise"][data-exercise="${exercise}"]`).click();
 if(exercise==='pushup')await page.locator('[data-action="tutorial-next"]').click();
 await page.locator('[data-action="start"]').click();
}
async function finish(page){await page.locator('[data-action="stop"]').click();await page.locator('[data-action="save-finish"]').click();await page.getByRole('heading',{name:'Есть результат!'}).waitFor();}
async function home(page){await page.locator('[data-action="home"]').click();}
(async()=>{
 let browser;const checks=[],errors=[],screenshots=[];const check=(name,passed)=>{assert.ok(passed,name);checks.push({name,passed:true});};
 const report={checkedAt:new Date().toISOString(),syntheticOnly:true,physicalPhoneTested:false,realCameraAccessed:false,realMessengerOpened:false,realMessageSent:false,fixture:'Constructed movement landmarks at 4 fps, real UI/tracker/state/report; mocked camera and native PNG share bridge.'};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of[390,360]){
   const context=await browser.newContext({viewport:{width,height:844}});await context.addInitScript(fixture);await context.addInitScript({content:poseFixture});
   await context.route('**/*',route=>{const u=new URL(route.request().url());if(!u.href.startsWith(BASE))return route.abort();if(u.pathname.endsWith('/camera.mjs'))return route.fulfill({headers:{...headers,'Content-Type':'text/javascript'},body:mockCamera});const target=path.resolve(ROOT,'app',decodeURIComponent(u.pathname.slice('/assets/app/'.length)));if(!target.startsWith(path.join(ROOT,'app')+path.sep)||!fs.existsSync(target))return route.fulfill({status:404,body:'Missing asset'});return route.fulfill({headers:{...headers,'Content-Type':types[path.extname(target)]||'application/octet-stream'},body:fs.readFileSync(target)});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'index.html');
   check(width+': legacy history, profile, coins and reminder survive launch',await page.evaluate(()=>{const s=__state();return s.history.length===5&&s.history[0].id==='legacy-0'&&s.theme==='orange'&&s.owned.includes('orange')&&s.coins===20&&s.xp===250&&s.reminder.time==='08:20'&&s.reminder.enabled===false&&s.reminder.days.join(',')==='1,3,5';}));
   const homeShot=path.join(ROOT,'preview/screens',`free-home-113-${width}.png`);await page.screenshot({path:homeShot,fullPage:true,animations:'disabled'});screenshots.push(homeShot);

   await start(page,'squat');await page.evaluate(()=>{for(let i=0;i<20;i++)__emit(null);});await page.locator('[data-action="stop"]').click();
   check(width+': zero approach cannot be saved or rewarded',await page.locator('[data-action="save-finish"]').count()===0&&await page.evaluate(()=>__state().history.length===5&&__state().coins===20&&__state().xp===250));
   await page.locator('[data-action="confirm-stop"]').click();

   await start(page,'squat');await page.evaluate(()=>{for(let i=0;i<3;i++)__rep();});
   check(width+': free counter has no goal denominator',await page.locator('#count-value').textContent()==='3'&&await page.locator('.counter').innerText().then(t=>!t.includes('/')));
   await finish(page);
   check(width+': finish below former goal saves actual positive result and reward',await page.evaluate(()=>{const s=__state(),h=s.history.at(-1);return s.history.length===6&&h.exercise==='squat'&&h.actual===3&&!(Number.isFinite(h.goal)&&h.goal>0)&&s.coins===40&&s.xp===300;}));
   await page.evaluate(()=>window.__drawnText=[]);await page.locator('[data-action="report"]').click();
   check(width+': report contains actual count without fake goal',await page.evaluate(()=>{const lines=__drawnText;return lines.includes('3')&&!lines.some(t=>/^\d+\s*\/\s*\d+/.test(t))&&!document.querySelector('#report-container canvas').getAttribute('aria-label').includes(' из ');}));
   const reportShot=path.join(ROOT,'preview/screens',`free-report-113-${width}.png`);await page.screenshot({path:reportShot,fullPage:true,animations:'disabled'});screenshots.push(reportShot);
   await page.locator('[data-action="share"]').click();
   check(width+': positive free result shares one PNG through native bridge',await page.evaluate(()=>__shares.length===1&&__shares[0].data.startsWith('data:image/png;base64,')&&__shares[0].data.length>10000&&/^share-/.test(__shares[0].id)));
   await page.locator('[data-action="back"]').click();await home(page);

   await page.locator('[data-action="request"]').click();await page.locator('[data-action="minutes"][data-minutes="30"]').click();await page.evaluate(()=>window.__drawnText=[]);await page.locator('[data-action="use-today"]').click();
   check(width+': dad request uses actual free result and selected minutes',await page.evaluate(()=>__drawnText.includes('3')&&__drawnText.includes('Папа, можно 30 минут')&&!__drawnText.some(t=>/^\d+\s*\/\s*\d+/.test(t))));
   await page.locator('[data-action="share"]').click();check(width+': dad request shares PNG without extra rewards',await page.evaluate(()=>__shares.length===2&&__state().history.length===6&&__state().coins===40&&__state().xp===300));
   await page.locator('[data-action="back"]').click();await home(page);

   await start(page,'squat');await page.evaluate(()=>{__hold();for(let i=1;i<=4;i++)__emit((1-Math.cos(2*Math.PI*i/8))/2);});await page.locator('#pause-button').click();await page.evaluate(()=>__emit(0));await page.locator('#pause-button').click();await page.evaluate(()=>{for(let i=5;i<=8;i++)__emit((1-Math.cos(2*Math.PI*i/8))/2);__hold();});
   check(width+': pause/resume cannot stitch a half repetition',await page.locator('#count-value').textContent()==='0');
   await page.evaluate(()=>{for(let i=0;i<22;i++)__rep();});
   check(width+': counting past former squat goal never auto-finishes',await page.locator('#count-value').textContent()==='22'&&await page.locator('[data-action="stop"]').count()===1&&await page.evaluate(()=>__state().history.length===6));
   await page.evaluate(()=>document.querySelector('.camera-top').lastChild.textContent=' СИНТЕТИЧЕСКИЙ ТЕСТ · СВОБОДНЫЙ СЧЁТ');
   check(width+': free workout has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.waitForFunction(()=>document.querySelector('#toast').classList.contains('hidden'));
   const counterShot=path.join(ROOT,'preview/screens',`free-counter-113-${width}.png`);await page.screenshot({path:counterShot,fullPage:true,animations:'disabled'});screenshots.push(counterShot);
   await page.locator('[data-action="stop"]').click();await page.locator('[data-action="cancel-stop"]').click();
   check(width+': cancel finish resumes running approach',await page.locator('#pause-button').textContent()==='Пауза');await page.evaluate(()=>__rep());check(width+': cancelled finish can continue counting',await page.locator('#count-value').textContent()==='23');
   await finish(page);check(width+': second squat approach today is saved but not rewarded twice',await page.evaluate(()=>__state().history.length===7&&__state().history.at(-1).actual===23&&__state().coins===40&&__state().xp===300));await home(page);

   await start(page,'pushup');await page.evaluate(()=>{for(let i=0;i<11;i++)__rep();});check(width+': pushups continue past ten until explicit finish',await page.locator('#count-value').textContent()==='11'&&await page.evaluate(()=>__state().history.length===7));await finish(page);check(width+': pushup result stores actual eleven',await page.evaluate(()=>__state().history.at(-1).actual===11&&__state().history.at(-1).exercise==='pushup'));await home(page);
   await start(page,'plank');await page.evaluate(()=>{for(let i=0;i<267;i++)__emit(0);});const held=Number(await page.locator('#count-value').textContent());check(width+': plank continues beyond sixty seconds',held>60&&await page.locator('[data-action="stop"]').count()===1);await finish(page);check(width+': plank saves held duration beyond sixty',await page.evaluate(()=>__state().history.at(-1).actual>60&&__state().history.at(-1).exercise==='plank'));await home(page);
   await start(page,'pullup');await page.evaluate(()=>{__rep();__rep();});check(width+': pullups continue beyond one',await page.locator('#count-value').textContent()==='2');await finish(page);check(width+': pullup result stores actual two',await page.evaluate(()=>__state().history.at(-1).actual===2&&__state().history.at(-1).exercise==='pullup'));
   await page.evaluate(()=>{for(let i=0;i<5;i++)__rep();});check(width+': stale frames after finish do not duplicate history',await page.evaluate(()=>__state().history.length===10));
   await page.reload();check(width+': mixed legacy/free history and settings survive reload',await page.evaluate(()=>{const s=__state();return s.history.length===10&&s.history[0].goal===10&&s.history[0].id==='legacy-0'&&s.theme==='orange'&&s.sound===false&&s.reminder.time==='08:20'&&s.reminder.days.join(',')==='1,3,5'&&s.reminder.enabled===false;}));
   await page.locator('[data-action="nav"][data-screen="settings"]').click();check(width+': settings do not impose exercise targets',await page.locator('#plan-form').count()===0);
   check(width+': settings identify installed build 1.0.14',await page.locator('body').innerText().then(t=>t.includes('1.0.14')));
   const settingsShot=path.join(ROOT,'preview/screens',`free-settings-113-${width}.png`);await page.screenshot({path:settingsShot,fullPage:true,animations:'disabled'});screenshots.push(settingsShot);
   // Fresh ephemeral fixture exercises the request-first path independently.
   await page.evaluate(()=>localStorage.removeItem('arseniy-move-v1'));await page.reload();await page.locator('[data-action="request"]').click();await page.locator('[data-action="minutes"][data-minutes="45"]').click();await page.locator('[data-action="start-request"]').click();await page.locator('[data-action="tutorial-next"]').click();await page.evaluate(()=>{window.__exercise='pushup';window.__time=0;});await page.locator('[data-action="start"]').click();await page.evaluate(()=>{__rep();__rep();});await finish(page);await page.evaluate(()=>window.__drawnText=[]);await page.locator('[data-action="report"]').click();
   check(width+': request-first free workout keeps two actual pushups and forty-five minutes',await page.evaluate(()=>__drawnText.includes('2')&&__drawnText.includes('Папа, можно 45 минут')&&__state().history.length===6&&__state().history.at(-1).actual===2));
   await page.locator('[data-action="share"]').click();check(width+': request-first result still opens PNG share bridge',await page.evaluate(()=>__shares.length===1&&__shares[0].data.startsWith('data:image/png;base64,')));
   await context.close();
  }
  check('No unhandled JavaScript errors',errors.length===0);report.passed=true;
 }catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
 finally{await browser?.close();Object.assign(report,{checks,errors,screenshots});fs.writeFileSync(path.join(ROOT,'docs/free-count-ui-qa-113.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
