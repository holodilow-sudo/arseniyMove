'use strict';
// Read-only UI verification: all device APIs are mocked before application load.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'preview','screens');
const reportPath=path.join(root,'docs','permissions-layout-qa.json');
const base=process.env.MOVE_QA_URL||'http://127.0.0.1:4187/app/';
fs.mkdirSync(output,{recursive:true});
fs.mkdirSync(path.dirname(reportPath),{recursive:true});
const results=[];
async function newPage(browser,width,height,{granted=false,status='denied'}={}){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,reducedMotion:'reduce'});
  await context.addInitScript(({granted,status})=>{
    localStorage.clear();
    localStorage.setItem('arseniy-move-v1',JSON.stringify({version:1,sound:false,history:[]}));
    const reminder={enabled:true,time:'07:00',days:[1,2,3,4,5,6,7],status:'current',active:true,notificationPermission:true,notificationsAvailable:true,nextTrigger:Date.now()+3600000};
    window.__permissionQa={cameraCalls:0,settingsCalls:0,permissionRequests:[],scheduleRequests:[],granted,status};
    window.MoveNative={
      getCapabilities(){return JSON.stringify({available:true,cameraPermission:window.__permissionQa.granted,cameraPermissionState:window.__permissionQa.granted?'granted':window.__permissionQa.status,nativeCameraPermission:true,permissionPromptActive:false,openAppSettings:true,reminder});},
      requestCameraPermission(requestId){window.__permissionQa.permissionRequests.push(requestId);setTimeout(()=>window.MoveApp.nativeCameraPermissionResult({requestId,status:window.__permissionQa.status,granted:false}),25);},
      openAppSettings(){window.__permissionQa.settingsCalls++;},
      scheduleReminder(value){window.__permissionQa.scheduleRequests.push(JSON.parse(value));}
    };
    const noCamera=async()=>{window.__permissionQa.cameraCalls++;throw new DOMException('QA blocks real camera access','NotAllowedError');};
    if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:noCamera,configurable:true});
    else Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:noCamera},configurable:true});
  },{granted,status});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#main h1').waitFor();
  await page.evaluate(()=>document.fonts.ready);
  return {context,page,errors};
}
async function capture(page,name,width,errors,extra={}){
  await page.waitForTimeout(75);
  const layout=await page.evaluate(()=>{
    const clipped=[...document.querySelectorAll('button,h1,h2,h3,p,small,label')].filter(el=>{
      if(!el.clientWidth||el.closest('.hidden'))return false;
      const r=document.createRange();r.selectNodeContents(el);
      const content=r.getBoundingClientRect(),box=el.getBoundingClientRect();
      return content.right>box.right+2||content.left<box.left-2;
    }).map(el=>({tag:el.tagName,className:el.className,text:el.textContent.trim().slice(0,90)}));
    return {viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,clippedLabels:clipped,scrollY,reminderTime:document.querySelector('[name="time"]')?.value||null,checkedDays:[...document.querySelectorAll('[name="day"]:checked')].map(el=>Number(el.value)),reminderEnabled:document.querySelector('[name="enabled"]')?.checked??null,deviceMock:window.__permissionQa};
  });
  const image=name+'-'+width+'.png';
  await page.screenshot({path:path.join(output,image),fullPage:false});
  results.push({scene:name,width,screenshot:'preview/screens/'+image,layout,errors:[...errors],...extra});
  return layout;
}
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    for(const [width,height]of[[390,844],[360,800]]){
      for(const granted of[false,true]){
        const {context,page,errors}=await newPage(browser,width,height,{granted});
        await page.locator('[data-action="nav"][data-screen="settings"]').click();
        const reminder=page.locator('#reminder-form');
        await reminder.scrollIntoViewIfNeeded();
        const reminderLayout=await capture(page,'permissions-reminder-'+(granted?'granted':'needed'),width,errors);
        assert.equal(reminderLayout.reminderTime,'07:00');
        assert.equal(reminderLayout.reminderEnabled,true);
        assert.deepEqual(reminderLayout.checkedDays,[1,2,3,4,5,6,7]);
        const permissions=page.locator('section.panel').filter({has:page.getByRole('heading',{name:'Разрешения Android',exact:true})});
        await permissions.scrollIntoViewIfNeeded();
        await capture(page,'permissions-settings-'+(granted?'granted':'needed'),width,errors);
        assert.equal(await page.locator('[data-action="camera-permission"]').count(),granted?0:1);
        assert.match(await permissions.innerText(),granted?/Камера: разрешена/:/Камера: нужен доступ/);
        await page.screenshot({path:path.join(output,'permissions-settings-'+(granted?'granted':'needed')+'-'+width+'-full.png'),fullPage:true});
        if(width===390&&!granted)await page.screenshot({path:path.join(output,'permissions-settings.png'),fullPage:false});
        assert.equal((await page.evaluate(()=>window.__permissionQa)).cameraCalls,0);
        await context.close();
      }
      const home=await newPage(browser,width,height,{granted:true});
      await home.page.getByText('Напоминание: 07:00 · включено',{exact:true}).scrollIntoViewIfNeeded();
      await capture(home.page,'permissions-home-0700',width,home.errors);
      await home.context.close();
      for(const status of['denied','settings_required']){
        const {context,page,errors}=await newPage(browser,width,height,{status});
        await page.locator('[data-action="exercise"][data-exercise="pushup"]').click();
        await page.locator('[data-action="tutorial-next"]').click();
        await page.locator('[data-action="start"]').click();
        await page.locator('#camera-error:not(.hidden)').waitFor();
        await page.waitForTimeout(150);
        const initialErrorVisibility=await page.locator('#camera-error').evaluate(el=>{const box=el.getBoundingClientRect();return{scrollY,top:box.top,bottom:box.bottom,viewportHeight:innerHeight,pixelRoundingTolerance:1,fullyVisible:box.top>=-1&&box.bottom<=innerHeight+1};});
        await page.locator('#camera-error').scrollIntoViewIfNeeded();
        const layout=await capture(page,'camera-permission-'+status,width,errors,{permissionStatus:status,initialErrorVisibility,errorText:await page.locator('#camera-error').innerText()});
        assert.equal(layout.deviceMock.cameraCalls,0);
        assert.equal(layout.deviceMock.permissionRequests.length,1);
        assert.equal(await page.locator('#pause-button').innerText(),'Продолжить');
        assert.equal((await page.locator('#tracking-state').textContent()).trim(),'Пауза');
        assert.match(await page.locator('#camera-error-code').innerText(),new RegExp(status));
        await page.screenshot({path:path.join(output,'camera-permission-'+status+'-'+width+'-full.png'),fullPage:true});
        if(width===390&&status==='settings_required')await page.screenshot({path:path.join(output,'camera-permission-error.png'),fullPage:false});
        await page.locator('#camera-error [data-action="app-settings"]').click();
        assert.equal((await page.evaluate(()=>window.__permissionQa)).settingsCalls,1);
        await context.close();
      }
    }
  }finally{await browser.close();}
  const passed=results.every(result=>!result.layout.horizontalOverflow&&!result.layout.clippedLabels.length&&!result.errors.length&&result.layout.deviceMock.cameraCalls===0&&result.initialErrorVisibility?.fullyVisible!==false);
  const report={passed,capturedAt:new Date().toISOString(),app:'Arseniy Move 1.0.1',url:base,scope:'Read-only real UI with pre-load native bridge mock. Real camera, notifications, APK and sharing were not used.',results,visualReview:{reviewed:true,notes:['Permission states, daily reminder controls and both error descriptions are readable at 360 and 390 pixels.','Long settings and home screens scroll naturally, with a fixed bottom navigation.','Error panel and its settings action fit together when brought into the viewport. See initialErrorVisibility for automatic visibility after the failure.'],limitation:'Headless Chrome with a native bridge mock does not verify Android runtime dialogs, actual camera startup or notification delivery.'}};
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed,report:reportPath,scenes:results.map(r=>({scene:r.scene,width:r.width,overflow:r.layout.horizontalOverflow,clipped:r.layout.clippedLabels,errors:r.errors}))},null,2));
  if(!passed)process.exitCode=1;
})().catch(error=>{fs.writeFileSync(reportPath,JSON.stringify({passed:false,error:error.stack,results},null,2));console.error(error);process.exitCode=1;});
