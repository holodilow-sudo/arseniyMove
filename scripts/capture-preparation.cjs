const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'preview'),checks=[];
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [390,360]){
  const ctx=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:1,reducedMotion:'reduce'}),page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const id of ['pushup','squat','plank','pullup']){
   await page.goto('http://127.0.0.1:4187/app/?preview=1');await page.waitForFunction(()=>window.MovePreview);
   await page.locator(`[data-action="exercise"][data-exercise="${id}"]`).click();
   if(id==='pushup')await page.locator('[data-action="tutorial-next"]').click();
   await page.evaluate(async()=>{await document.fonts.ready;const im=new Image();im.src='exercise-art-v2.png';await im.decode()});
   const layout=await page.evaluate(()=>{const art=document.querySelector('.setup-art>.exercise-art'),tile=document.querySelector('.setup-art'),goal=tile.querySelector('div');return{overflow:document.documentElement.scrollWidth>innerWidth,svg:tile.querySelectorAll('svg').length,artWidth:art.clientWidth,goal:goal.textContent,overlap:art.getBoundingClientRect().right>goal.getBoundingClientRect().left,background:getComputedStyle(art).backgroundImage}});
   assert(!layout.overflow&&!layout.overlap&&!layout.svg&&layout.artWidth>120&&layout.background.includes('exercise-art-v2.png'),JSON.stringify({id,width,layout}));
   checks.push({id,width,...layout});
   if(width===390){
    await page.locator('.setup-art').screenshot({path:path.join(OUT,`preparation-${id}.png`)});
    if(id==='pushup'){await page.screenshot({path:path.join(OUT,'screens/setup.png'),fullPage:true});await page.screenshot({path:path.join(OUT,'screens/setup-phone.png')});}
   }
   await page.screenshot({path:path.join(OUT,'design-qa',`preparation-${id}-${width}.png`),fullPage:true});
  }
  await page.evaluate(()=>MovePreview.show('workout'));
  assert(await page.locator('#camera-placeholder>.exercise-art').count()===1);
  if(width===390){await page.screenshot({path:path.join(OUT,'screens/workout.png'),fullPage:true});await page.screenshot({path:path.join(OUT,'screens/workout-phone.png')});}
  assert(errors.length===0,errors.join('\n'));await ctx.close();
 }
 await browser.close();fs.writeFileSync(path.join(ROOT,'docs/preparation-art-qa.json'),JSON.stringify({passed:true,checks},null,2));console.log('All four preparation illustrations verified at 390/360px; no old exercise SVG or overlap.');
})().catch(e=>{console.error(e);process.exitCode=1});
