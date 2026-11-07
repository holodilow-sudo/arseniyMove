const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'preview'),SHOTS=path.join(OUT,'screens');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const checks=[];
 for(const width of [390,360]){
  const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,reducedMotion:'reduce'});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const scene of ['home','tutorial','request-report']){
   await page.goto('http://127.0.0.1:4187/app/?preview=1&screen='+scene);
   await page.waitForFunction(()=>window.MovePreview);await page.evaluate(()=>document.fonts.ready);
   if(scene==='home')await page.evaluate(async()=>{const im=new Image();im.src='exercise-art-v2.png';await im.decode()});
   await page.waitForTimeout(300);
   await page.screenshot({path:path.join(OUT,'design-qa',`${scene}-updated-${width}.png`),fullPage:true,style:'.bottom-nav{position:absolute!important;bottom:0!important}'});
   if(width===390){
    await page.screenshot({path:path.join(SHOTS,scene+'.png'),fullPage:true,style:'.bottom-nav{position:absolute!important;bottom:0!important}'});
    await page.screenshot({path:path.join(SHOTS,scene+'-phone.png')});
    if(scene==='home')await page.locator('.workout-grid').screenshot({path:path.join(OUT,'exercise-tiles.png'),style:'.bottom-nav{visibility:hidden!important}'});
   }
   checks.push({scene,width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),errors:[...errors]});
  }
  await context.close();
 }
 await browser.close();
 if(checks.some(x=>x.overflow||x.errors.length))throw Error(JSON.stringify(checks));
 fs.writeFileSync(path.join(ROOT,'docs','update-layout-qa.json'),JSON.stringify({passed:true,checks},null,2));
 console.log('Updated home, tutorial and share screens at 390/360 px; no overflow or page errors.');
})().catch(e=>{console.error(e);process.exitCode=1});
