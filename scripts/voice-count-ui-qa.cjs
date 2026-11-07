/* Synthetic pose + native TTS bridge tests. No camera, loudspeaker or messenger is used. */
const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE='https://appassets.androidplatform.net/assets/app/';
const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.mp4':'video/mp4','.vtt':'text/vtt'};
const CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const headers={'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(self), microphone=(), geolocation=()','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':CSP};
const mockCamera=`export class VisionCamera {async start(options){window.__cameraOptions=options;window.__cameraCalls.push(options.facing);options.onPreview({facing:options.facing});options.onStatus('Встань целиком в кадр');}stop(){window.__cameraStops=(window.__cameraStops||0)+1;}}`;
function fixture(){
 window.__cameraCalls=[];window.__shares=[];window.__drawnText=[];window.__time=0;window.__exercise='squat';
 window.__speechCalls=[];window.__nativeEvents=[];window.__speechState='ready';window.__speechSettings=0;
 const reminder={enabled:false,time:'08:20',days:[1,3,5],status:'current',active:false,notificationPermission:true,notificationsAvailable:true};
 const caps={available:true,appVersion:'1.0.5',cameraPermission:true,cameraPermissionState:'granted',nativeCameraPermission:true,permissionPromptActive:false,openAppSettings:true,manufacturer:'TestMaker',model:'SyntheticPhone',androidVersion:'13',webViewVersion:'123.0.0.0',reminder,nativeSpeech:true,speechAvailable:false,speechState:'idle',speechMessage:'',openSpeechSettings:true};
 window.__emitSpeechStatus=state=>{
  window.__speechState=state;caps.speechState=state;caps.speechAvailable=state==='ready';
  window.MoveApp?.nativeSpeechStatus({state,available:state==='ready',message:state==='unavailable'?'Русский голос не установлен. Открой настройки голоса телефона.':state==='ready'?'Русский голос готов.':'Готовим русский голос…',offline:state==='ready',language:'ru-RU'});
 };
 window.MoveNative={
  getCapabilities:()=>JSON.stringify(caps),openAppSettings:()=>{},
  prepareCounterSpeech:()=>{window.__nativeEvents.push('prepare');queueMicrotask(()=>window.__emitSpeechStatus(window.__speechState));},
  speakCounter:text=>{window.__speechCalls.push(String(text));window.__nativeEvents.push('speak:'+text);},
  stopCounterSpeech:()=>window.__nativeEvents.push('stop'),
  openSpeechSettings:()=>window.__speechSettings++
 };
 window.AndroidShare={shareImage:(data,id)=>window.__shares.push({data,id})};
 const fill=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.__drawnText.push(String(text));return fill.call(this,text,...args);};
 if(!localStorage.getItem('arseniy-move-v1')){
  const history=Array.from({length:5},(_,i)=>({id:'legacy-'+i,exercise:'pushup',actual:10,goal:10,source:'camera-estimate',trackedFrames:100,endedAt:`2026-09-${20+i}T12:00:00Z`}));
  // Legacy effects preference is off; new voice preference must default on independently.
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
async function settings(page){await page.locator('[data-action="nav"][data-screen="settings"]').click();}
async function fromSettings(page){await page.locator('[data-action="nav"][data-screen="home"]').click();}
async function resetCalls(page){await page.evaluate(()=>{window.__speechCalls=[];window.__nativeEvents=[];});}
async function calls(page){return page.evaluate(()=>window.__speechCalls);}
async function repetitions(page,n){for(let i=0;i<n;i++)await page.evaluate(()=>window.__rep());}
async function discard(page){await page.locator('[data-action="stop"]').click();await page.locator('[data-action="confirm-stop"]').click();}
async function routeAssets(context,base=BASE){
 await context.route('**/*',route=>{
  const u=new URL(route.request().url());if(!u.href.startsWith(base))return route.abort();
  if(u.pathname.endsWith('/camera.mjs'))return route.fulfill({headers:{...headers,'Content-Type':'text/javascript'},body:mockCamera});
  const relative=decodeURIComponent(u.pathname.slice(new URL(base).pathname.length)),target=path.resolve(ROOT,'app',relative);
  if(!target.startsWith(path.join(ROOT,'app')+path.sep)||!fs.existsSync(target))return route.fulfill({status:404,body:'Missing asset'});
  return route.fulfill({headers:{...headers,'Content-Type':types[path.extname(target)]||'application/octet-stream'},body:fs.readFileSync(target)});
 });
}
(async()=>{
 let browser;const checks=[],errors=[],screenshots=[];const check=(name,passed)=>{assert.ok(passed,name);checks.push({name,passed:true});};
 const report={checkedAt:new Date().toISOString(),syntheticOnly:true,physicalPhoneTested:false,realCameraAccessed:false,physicalVoiceAudibilityVerified:false,realMessengerOpened:false,realMessageSent:false,fixture:'Real production UI, pose tracker, speech controller and state; constructed 4 fps poses and mocked Android TTS/status/PNG share bridge. Recorded text requests are not proof of audible playback.'};
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const width of[390,360]){
   const context=await browser.newContext({viewport:{width,height:844}});await context.addInitScript(fixture);await context.addInitScript({content:poseFixture});await routeAssets(context);
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'index.html');
   check(width+': opening home never announces stored results',(await calls(page)).length===0);
   await settings(page);
   check(width+': old effects preference is retained and new voice defaults on',await page.locator('#voice-switch').isChecked()&&!await page.locator('#sound-switch').isChecked());
   check(width+': settings identify build 1.0.5',await page.locator('body').innerText().then(t=>t.includes('1.0.5')));
   await page.locator('[data-action="test-voice"]').click();
   check(width+': explicit voice test calls native bridge',(await calls(page)).length===1);
   check(width+': successful native readiness is visible',await page.locator('#voice-status').innerText().then(t=>t.includes('Голос готов')));
   check(width+': settings have no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const settingsShot=path.join(ROOT,'preview/screens',`voice-settings-105-${width}.png`);await page.screenshot({path:settingsShot,fullPage:true,animations:'disabled'});screenshots.push(settingsShot);
   const voicePanel=page.locator('section.panel').filter({has:page.locator('#voice-switch')}),panelShot=path.join(ROOT,'preview/screens',`voice-panel-105-${width}.png`);await voicePanel.scrollIntoViewIfNeeded();await voicePanel.screenshot({path:panelShot,animations:'disabled'});screenshots.push(panelShot);
   await fromSettings(page);await resetCalls(page);await start(page,'squat');
   check(width+': starting approach prepares voice silently',await page.evaluate(()=>__nativeEvents.includes('prepare')&&__speechCalls.length===0));
   await page.evaluate(()=>{for(let i=0;i<12;i++)__emit(null);});
   check(width+': empty camera frames never announce a count',(await calls(page)).length===0);
   await repetitions(page,3);
   check(width+': three real tracker completions announce exactly three ascending counts',JSON.stringify(await calls(page))===JSON.stringify(['1','2','3']));
   await page.evaluate(()=>{for(let i=0;i<12;i++)__emit(0);});
   check(width+': repeated frames with the same total do not repeat speech',(await calls(page)).length===3);
   const stopsBeforePause=await page.evaluate(()=>__nativeEvents.filter(e=>e==='stop').length);await page.locator('#pause-button').click();
   check(width+': pause cancels native speech',await page.evaluate(n=>__nativeEvents.filter(e=>e==='stop').length>n,stopsBeforePause));
   await repetitions(page,2);check(width+': late camera frames during pause stay silent',(await calls(page)).length===3);
   await page.locator('#pause-button').click();await page.evaluate(()=>__hold());
   check(width+': resume does not repeat the previous count',(await calls(page)).length===3);
   await repetitions(page,1);check(width+': next rep after resume announces only new total',(await calls(page)).at(-1)==='4'&&(await calls(page)).length===4);
   await page.locator('[data-action="sound"]').click();const mutedCalls=(await calls(page)).length;await repetitions(page,1);
   check(width+': master mute persists and suppresses voice while count advances',await page.locator('#count-value').textContent()==='5'&&(await calls(page)).length===mutedCalls&&await page.evaluate(()=>__state().muted===true));
   await page.locator('[data-action="sound"]').click();await page.evaluate(()=>__hold());
   check(width+': unmute does not replay muted repetitions',(await calls(page)).length===mutedCalls);
   await repetitions(page,1);check(width+': unmute announces next actual total',(await calls(page)).at(-1)==='6');
   const beforeBackground=(await calls(page)).length,stopsBeforeBackground=await page.evaluate(()=>__nativeEvents.filter(e=>e==='stop').length);
   await page.evaluate(()=>window.MoveApp.pauseForBackground());await repetitions(page,1);
   check(width+': native background callback pauses camera and cancels speech',await page.locator('#pause-button').textContent()==='Продолжить'&&(await calls(page)).length===beforeBackground&&await page.evaluate(n=>__nativeEvents.filter(e=>e==='stop').length>n,stopsBeforeBackground));
   await page.locator('#pause-button').click();await page.evaluate(()=>__hold());check(width+': background resume does not repeat last count',(await calls(page)).length===beforeBackground);
   await repetitions(page,1);check(width+': resumed approach announces seventh rep',(await calls(page)).at(-1)==='7');
   const beforeFinish=(await calls(page)).length,stopsBeforeFinish=await page.evaluate(()=>__nativeEvents.filter(e=>e==='stop').length);await finish(page);
   check(width+': finish stops count voice and preserves actual free result',await page.evaluate(n=>__nativeEvents.filter(e=>e==='stop').length>n&&__state().history.at(-1).actual===7&&__state().history.at(-1).goal===null,stopsBeforeFinish));
   await repetitions(page,1);await page.locator('[data-action="report"]').click();
   check(width+': result and report never announce exercise count',(await calls(page)).length===beforeFinish);
   check(width+': report still displays actual seven without a goal',await page.evaluate(()=>__drawnText.includes('7')&&!__drawnText.some(t=>/^\d+\s*\/\s*\d+/.test(t))));
   await page.locator('[data-action="share"]').click();check(width+': native PNG share and MAX route remain available',await page.evaluate(()=>__shares.length===1&&__shares[0].data.startsWith('data:image/png;base64,')&&document.querySelector('.share-route').textContent.includes('MAX')));
   await page.locator('[data-action="back"]').click();await home(page);await page.locator('[data-action="nav"][data-screen="progress"]').click();await page.locator('[data-action="history"]').first().click();
   check(width+': reading history report never announces a stored count',(await calls(page)).length===beforeFinish);
   await page.locator('[data-action="back"]').click();await home(page);

   await settings(page);await page.locator('#voice-switch').uncheck();await page.locator('#sound-switch').check();await fromSettings(page);await resetCalls(page);await start(page,'pushup');await repetitions(page,2);
   check(width+': voice switch off preserves counter with effects on',(await calls(page)).length===0&&await page.locator('#count-value').textContent()==='2'&&await page.evaluate(()=>__state().voiceCount===false&&__state().sound===true));
   await finish(page);await home(page);await settings(page);await page.locator('#voice-switch').check();await page.locator('#sound-switch').uncheck();await fromSettings(page);await resetCalls(page);
   await start(page,'pushup');await repetitions(page,2);
   check(width+': voice counts pushups independently of effect sounds',JSON.stringify(await calls(page))===JSON.stringify(['1','2']));await finish(page);await home(page);await resetCalls(page);
   await start(page,'pullup');await repetitions(page,2);
   check(width+': voice counts pullups beyond the old one-rep goal',JSON.stringify(await calls(page))===JSON.stringify(['1','2'])&&await page.locator('#count-value').textContent()==='2');await finish(page);await home(page);await resetCalls(page);

   await start(page,'plank');await page.evaluate(()=>{for(let i=0;i<39;i++)__emit(0);});
   check(width+': plank does not announce before ten tracked seconds',(await calls(page)).length===0);
   await page.evaluate(()=>{for(let i=0;i<50;i++)__emit(0);});
   check(width+': plank announces ten and twenty seconds once each',JSON.stringify(await calls(page))===JSON.stringify(['10 секунд','20 секунд']));
   await page.locator('#pause-button').click();const heldBefore=await page.locator('#count-value').textContent();await page.evaluate(()=>{for(let i=0;i<50;i++)__emit(0);});
   check(width+': plank pause excludes elapsed frames from time and speech',await page.locator('#count-value').textContent()===heldBefore&&(await calls(page)).length===2);
   await page.locator('#pause-button').click();await page.evaluate(()=>{for(let i=0;i<178;i++)__emit(0);});
   check(width+': resumed plank announces successive tens past sixty',JSON.stringify(await calls(page))===JSON.stringify(['10 секунд','20 секунд','30 секунд','40 секунд','50 секунд','60 секунд'])&&Number(await page.locator('#count-value').textContent())>60);
   await finish(page);await home(page);await resetCalls(page);

   await settings(page);await page.evaluate(()=>window.__emitSpeechStatus('unavailable'));
   check(width+': unavailable Russian voice is explained in settings',await page.locator('#voice-status').innerText().then(t=>t.includes('не установлен')));
   await page.locator('[data-action="voice-settings"]').click();check(width+': voice settings open only after explicit tap',await page.evaluate(()=>__speechSettings===1));await fromSettings(page);await start(page,'squat');await repetitions(page,1);
   check(width+': unavailable voice does not block exercise counting',await page.locator('#count-value').textContent()==='1'&&await page.locator('#voice-workout-status').isVisible());
   const unavailableShot=path.join(ROOT,'preview/screens',`voice-unavailable-105-${width}.png`);await page.screenshot({path:unavailableShot,fullPage:true,animations:'disabled'});screenshots.push(unavailableShot);await discard(page);
   await page.evaluate(()=>window.__emitSpeechStatus('ready'));await settings(page);await page.locator('[data-action="sound"]').click();await page.reload();
   check(width+': audio settings and legacy history/profile/reminder survive reload',await page.evaluate(()=>{const s=__state();return s.muted===true&&s.voiceCount===true&&s.sound===false&&s.history[0].id==='legacy-0'&&s.history[0].goal===10&&s.theme==='orange'&&s.owned.includes('orange')&&s.reminder.time==='08:20'&&s.reminder.days.join(',')==='1,3,5';}));
   check(width+': reload while muted does not announce anything',(await calls(page)).length===0);await context.close();
  }
  const demoBase='http://localhost:4199/assets/app/',demoContext=await browser.newContext({viewport:{width:390,height:844}});await demoContext.addInitScript(fixture);await demoContext.addInitScript({content:poseFixture});await routeAssets(demoContext,demoBase);const demo=await demoContext.newPage();demo.on('pageerror',e=>errors.push(e.message));await demo.goto(demoBase+'index.html?preview=1');await start(demo,'squat');await demo.waitForFunction(()=>Number(document.querySelector('#count-value')?.textContent)>=2);
  check('Demonstration counter never calls native voice',(await calls(demo)).length===0);await demo.evaluate(()=>window.MovePreview.show('report'));check('Demonstration report never speaks',(await calls(demo)).length===0);await demoContext.close();
  check('No unhandled JavaScript errors',errors.length===0);report.passed=true;
 }catch(error){report.passed=false;report.error=String(error.stack||error);process.exitCode=1;}
 finally{await browser?.close();Object.assign(report,{checks,errors,screenshots});fs.writeFileSync(path.join(ROOT,'docs/voice-count-ui-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
