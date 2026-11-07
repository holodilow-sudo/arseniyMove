const {chromium}=require('C:/Users/илья/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Chita'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://localhost/**',route=>{
      const f=path.join(process.cwd(),'app',decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//,'')||'index.html');
      return route.fulfill({body:fs.readFileSync(f),contentType:({'.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.html':'text/html'})[path.extname(f)]||'application/octet-stream'});
    });
    await page.goto('http://localhost/index.html?preview=1');
    await page.locator('[data-screen="progress"]').click();
    assert.match(await page.locator('.progress-streak').innerText(),/0/);
    assert.equal(await page.locator('.progress-day.missed').count(),0);
    await page.screenshot({path:'preview/screens/progress-111-empty.png',fullPage:true});
    // Seed realistic mixed legacy/free records through the real state API.
    await page.evaluate(async()=>{
      const {defaultState,completeSession}=await import('./state.mjs');const s=defaultState();
      for(let i=0;i<20;i++){
        if([4,8,9,14].includes(i))continue;
        const end=new Date();end.setDate(end.getDate()-i);end.setHours(0,0,0,0);
        for(let j=0;j<(i%3)+1;j++)completeSession(s,{id:`day-${i}-${j}`,exercise:j===0?'pushup':'plank',mode:i>10?undefined:'free',goal:i>10?10:null,actual:j===0?12:30,trackedFrames:40,source:'camera-estimate',endedAt:end.toISOString(),startedAt:new Date(end.getTime()-(j+1)*90000).toISOString()});
      }
      s.sound=false;s.voiceCount=false;s.reminder.enabled=true;
      localStorage.setItem('arseniy-move-preview-v1',JSON.stringify(s));
    });
    await page.reload();await page.locator('[data-screen="progress"]').click();
    const before=await page.evaluate(()=>JSON.stringify(window.MovePreview.getState()));
    assert.match(await page.locator('.progress-streak').innerText(),/4/);
    assert.equal(await page.locator('.progress-day').count(),7);
    assert.equal(await page.locator('.progress-column').count(),7);
    await page.screenshot({path:'preview/screens/progress-111-week.png',fullPage:true});
    await page.locator('[data-days="30"]').click();await page.locator('[data-metric="time"]').click();
    assert.equal(await page.locator('.progress-day').count(),30);
    assert.equal(await page.locator('.progress-column').count(),30);
    assert.equal(await page.locator('.progress-day.missed').count(),4);
    await page.locator('.progress-day.missed').first().click();
    assert.match(await page.locator('.progress-day-detail').innerText(),/Сохранённых подходов нет/);
    await page.locator('.progress-day.active').last().click();
    assert.match(await page.locator('.progress-day-detail').innerText(),/Отжимания/);
    assert.equal(await page.evaluate(()=>JSON.stringify(window.MovePreview.getState())),before);
    await page.screenshot({path:'preview/screens/progress-111-month.png',fullPage:true});
    for(const width of [320,360,390,520]){
      await page.setViewportSize({width,height:844});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow at ${width}`);
      assert.ok(await page.locator('.training-progress').evaluate(el=>el.scrollWidth<=el.clientWidth),`progress overflow at ${width}`);
    }
    await page.setViewportSize({width:320,height:844});await page.screenshot({path:'preview/screens/progress-111-narrow.png',fullPage:true});
    // Existing history still opens a report with the share action.
    await page.locator('.history-item').first().click();
    assert.equal(await page.locator('[data-action="share"]').count(),1);
    await page.reload();await page.locator('[data-screen="progress"]').click();
    assert.equal(await page.evaluate(()=>JSON.stringify(window.MovePreview.getState())),before);
    // Saving a new nonempty workout refreshes the chart immediately.
    await page.locator('[data-screen="home"]').click();
    await page.locator('[data-exercise="squat"]').click();
    await page.locator('[data-action="start"]').click();
    await page.waitForTimeout(2200);
    await page.locator('[data-action="stop"]').click();
    await page.locator('[data-action="save-finish"]').click();
    await page.locator('[data-action="home"]').click();
    await page.locator('[data-screen="progress"]').click();
    assert.match(await page.locator('.progress-day-detail').innerText(),/Приседания/);
    assert.equal((await page.evaluate(()=>window.MovePreview.getState())).history.length,JSON.parse(before).history.length+1);
    assert.deepEqual(errors,[]);
    console.log('PASS progress UI: empty/mixed history, 7/30 days, metric/day selection, read-only state, reload, share flow, 320–520px layouts.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
