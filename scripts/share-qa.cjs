const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE='http://127.0.0.1:4187/app/';
(async()=>{
  const results=[],errors=[],nativeRoot=path.join(ROOT,'android/src/main/java/ru/arseniy/move');
  const check=(name,ok,details)=>{assert.ok(ok,name+(details?' '+JSON.stringify(details):''));results.push({name,passed:true,...(details?{details}: {})});console.log('PASS '+name);};
  const controller=fs.readFileSync(path.join(nativeRoot,'ResultShareController.java'),'utf8'),provider=fs.readFileSync(path.join(nativeRoot,'ResultImageProvider.java'),'utf8'),activity=fs.readFileSync(path.join(nativeRoot,'MainActivity.java'),'utf8'),manifest=fs.readFileSync(path.join(ROOT,'android/src/main/AndroidManifest.xml'),'utf8');
  check('Native source uses ACTION_SEND image/png and content URI stream grants',controller.includes('Intent.ACTION_SEND).setType("image/png")')&&controller.includes('Intent.EXTRA_STREAM, uri')&&controller.includes('send.setClipData(ClipData.newUri')&&controller.includes('chooser.setClipData(send.getClipData())')&&controller.includes('Intent.FLAG_GRANT_READ_URI_PERMISSION')&&controller.includes('Intent.createChooser(send,'));
  check('Native provider is non-exported, read-only and restricted to result-card cache',manifest.includes('android:authorities="ru.arseniy.move.results"')&&manifest.includes('android:exported="false" android:grantUriPermissions="true"')&&provider.includes('if (!"r".equals(mode))')&&provider.includes('directory.equals(file.getParentFile())')&&provider.includes('getCacheDir(), DIRECTORY')&&provider.includes('MAX_BYTES = 4 * 1024 * 1024'));
  check('Native bridge validates trusted foreground and never assumes message delivery',activity.includes('foreground && isTrustedDocument() && shareController != null')&&controller.includes('BitmapFactory.decodeByteArray')&&controller.includes('Bitmap.CompressFormat.PNG')&&controller.includes('feedback.result(requestId, "opened")')&&!controller.includes('.setPackage('));
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(BASE+'?preview=1&screen=request-report');await page.waitForFunction(()=>window.MovePreview);
    const drawing=await page.evaluate(async()=>{
      const module=await import('./report.mjs');window.__reportModule=module;
      const original=CanvasRenderingContext2D.prototype.fillText;let lines=[];
      CanvasRenderingContext2D.prototype.fillText=function(text,...args){lines.push(String(text));return original.call(this,text,...args);};
      try{
        const fixture={id:'qa-only',exercise:'squat',actual:20,goal:20,endedAt:'2026-10-17T03:15:00Z',source:'camera-estimate',trackedFrames:200};
        const canvas=module.createReport(fixture,{minutes:30});window.__fixtureCanvas=canvas;
        const real={lines:[...lines],width:canvas.width,height:canvas.height};lines=[];
        module.createReport({...fixture,demo:true},{demo:false,minutes:30});const sessionDemo=[...lines];lines=[];
        module.createReport(fixture,{demo:true});const explicitDemo=[...lines];
        return {real,sessionDemo,explicitDemo};
      }finally{CanvasRenderingContext2D.prototype.fillText=original;}
    });
    check('PNG report contains actual exercise, exact goal and a 30-minute request',drawing.real.width===1080&&drawing.real.height===1350&&drawing.real.lines.includes('Приседания')&&drawing.real.lines.includes('20 / 20')&&drawing.real.lines.includes('Папа, можно 30 минут')&&drawing.real.lines.includes('Оценка движений камерой')&&drawing.real.lines.includes('Время в интернете одобряет папа.'),drawing.real);
    check('Demo session cannot lose its watermark through a false demo option',drawing.sessionDemo.includes('ДЕМО-ДАННЫЕ')&&drawing.sessionDemo.includes('ПРИМЕР ОТЧЁТА')&&drawing.sessionDemo.includes('Это макет. Реальная тренировка не проводилась.')&&!drawing.sessionDemo.includes('ВЫПОЛНЕНО'));
    check('Explicit preview report is also labelled as demo',drawing.explicitDemo.includes('ДЕМО-ДАННЫЕ')&&drawing.explicitDemo.includes('Демонстрационный результат'));
    await page.evaluate(()=>{window.__nativeCalls=[];window.AndroidShare={shareImage(dataUrl,id){__nativeCalls.push({dataUrl,id});}};});
    const nativeStatus=await page.evaluate(()=>__reportModule.shareReport(__fixtureCanvas,'share-qa-native'));
    const payload=await page.evaluate(()=>{const p=__nativeCalls[0],s=atob(p.dataUrl.split(',')[1]),bytes=Uint8Array.from(s,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);return {calls:__nativeCalls.length,id:p.id,prefix:p.dataUrl.slice(0,22),bytes:bytes.length,signature:Array.from(bytes.slice(0,8)),width:view.getUint32(16),height:view.getUint32(20)};});
    check('Mock Android bridge receives one real PNG with a valid request identifier',nativeStatus==='native'&&payload.calls===1&&payload.id==='share-qa-native'&&payload.prefix==='data:image/png;base64,'&&payload.bytes>10000&&payload.bytes<4*1024*1024&&payload.width===1080&&payload.height===1350&&payload.signature.join(',')==='137,80,78,71,13,10,26,10',payload);
    await page.locator('[data-action="share"]').click();await page.waitForFunction(()=>__nativeCalls.length===2);
    check('Application share action calls native bridge using its share-* protocol',await page.evaluate(()=>/^share-[a-zA-Z0-9-]{1,64}$/.test(__nativeCalls[1].id)&&__nativeCalls[1].dataUrl.startsWith('data:image/png;base64,')));
    await page.evaluate(()=>{delete window.AndroidShare;Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{const bytes=new Uint8Array(await data.files[0].arrayBuffer());window.__webPayload={title:data.title,name:data.files[0].name,type:data.files[0].type,size:bytes.length,signature:Array.from(bytes.slice(0,8))};}});});
    const webStatus=await page.evaluate(()=>__reportModule.shareReport(__fixtureCanvas,'share-qa-web'));
    const webPayload=await page.evaluate(()=>__webPayload);
    check('Browser Web Share receives the same PNG as a File',webStatus==='shared'&&webPayload.name==='Arseniy-Move-result.png'&&webPayload.type==='image/png'&&webPayload.signature.join(',')==='137,80,78,71,13,10,26,10',webPayload);
    let downloads=0;page.on('download',()=>downloads++);
    await page.evaluate(()=>{window.__cancelCalls=0;Object.defineProperty(navigator,'share',{configurable:true,value:async()=>{__cancelCalls++;throw new DOMException('Cancelled by user','AbortError');}});document.querySelector('#toast').classList.add('hidden');});
    await page.locator('[data-action="share"]').click();await page.waitForFunction(()=>__cancelCalls===1&&!document.querySelector('[data-action="share"]').disabled);
    check('Cancelling Web Share leaves no error toast and no automatic download',downloads===0&&await page.locator('#toast').evaluate(t=>t.classList.contains('hidden')));
    await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>false}));
    const downloadPromise=page.waitForEvent('download');
    const fallbackStatus=await page.evaluate(()=>__reportModule.shareReport(__fixtureCanvas,'share-qa-fallback'));
    const download=await downloadPromise,filename=download.suggestedFilename(),buffer=fs.readFileSync(await download.path());
    check('No browser file sharing falls back to a downloadable PNG',fallbackStatus==='saved'&&filename==='Arseniy-Move-result.png'&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&buffer.readUInt32BE(16)===1080&&buffer.readUInt32BE(20)===1350,{filename,bytes:buffer.length});
    check('Share preparation adds no rewards or extra history',await page.evaluate(()=>MovePreview.getState().coins===20&&MovePreview.getState().history.length===1));
    check('No unhandled browser errors',errors.length===0,{errors});
    const report={passed:true,checks:results.length,results,nativeAudit:'Source inspection only; ACTION_SEND and read-only content URI grant validated. Installed messenger targets are determined by Android.',realMessengerOpened:false,realMessageSent:false,nativeDeviceTested:false,apkBuilt:false};
    fs.writeFileSync(path.join(ROOT,'docs','share-qa.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
