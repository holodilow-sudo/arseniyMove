const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost/**',r=>{
   const f=path.join(process.cwd(),'app',decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\//,'')||'index.html');
   return r.fulfill({body:fs.readFileSync(f),contentType:({'.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html','.png':'image/png'})[path.extname(f)]||'application/octet-stream'});
  });
  await page.addInitScript(()=>{
   window.__update={state:'current',message:'Установлена последняя версия.',version:'',percent:-1};window.__allowed=[];window.__installs=0;window.__checks=0;
   window.MoveNative={getUpdateStatus:()=>JSON.stringify(window.__update),setUpdateAllowed:v=>window.__allowed.push(v),checkForUpdates:()=>window.__checks++,installUpdate:()=>window.__installs++};
   window.__status=s=>{window.__update=s;window.MoveApp.nativeUpdateStatus(s);};
  });
  await page.goto('http://localhost/index.html?preview=1');
  assert.equal(await page.locator('.update-panel').count(),0);
  assert.equal(await page.evaluate(()=>window.__allowed.at(-1)),true);
  await page.locator('[data-screen="settings"]').click();
  await page.locator('[data-action="check-update"]').click();assert.equal(await page.evaluate(()=>window.__checks),1);
  await page.evaluate(()=>__status({state:'downloading',message:'Скачиваем обновление…',percent:42,version:'1.0.13'}));
  assert.equal(await page.locator('progress').getAttribute('value'),'42');
  assert.equal(await page.locator('[data-action="check-update"]').isDisabled(),true);
  await page.evaluate(()=>__status({state:'error',message:'Нет интернета. Попробуй позже.'}));
  assert.equal(await page.locator('[data-action="check-update"]').isEnabled(),true);
  await page.locator('[data-screen="home"]').click();
  await page.evaluate(()=>__status({state:'ready',message:'Версия 1.0.13 скачана. Можно установить.',percent:100,version:'1.0.13'}));
  await page.locator('[data-action="install-update"]').click();assert.equal(await page.evaluate(()=>window.__installs),1);
  await page.screenshot({path:'preview/screens/update-112-ready.png',fullPage:true});
  await page.locator('[data-exercise="squat"]').click();assert.equal(await page.evaluate(()=>window.__allowed.at(-1)),false);
  await page.locator('[data-action="start"]').click();
  const workout=await page.locator('#count-value').elementHandle();
  await page.evaluate(()=>__status({state:'ready',version:'1.0.13',message:'Готово'}));
  assert.equal(await page.locator('[data-action="install-update"]').count(),0);
  assert.equal(await workout.evaluate(el=>el.isConnected),true); // Update callback must never replace camera/workout DOM.
  await page.locator('[data-action="stop"]').click();await page.locator('[data-action="confirm-stop"]').click();
  assert.equal(await page.locator('[data-action="install-update"]').count(),1);
  await page.locator('[data-screen="settings"]').click();
  await page.evaluate(()=>__status({state:'permission',version:'1.0.13',message:'Разреши установку обновлений из Arseniy Move.'}));
  assert.equal(await page.locator('[data-action="install-update"]').count(),1);
  await page.evaluate(()=>__status({state:'error',message:'<img src=x onerror=alert(1)>',version:'<script>'}));
  assert.equal(await page.locator('.update-panel img').count(),0);
  for(const width of [320,390,520]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.evaluate(()=>__status({state:'current',message:'Установлена последняя версия.'}));
  await page.setViewportSize({width:390,height:844});await page.locator('#update-settings').scrollIntoViewIfNeeded();await page.screenshot({path:'preview/screens/update-112-settings.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS updater UI: check/download/progress/error/retry/ready/permission, no interruption or DOM replacement during workout, safe text, 320–520px layouts.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
