import assert from 'node:assert/strict';
import {defaultState,completeSession,loadState,dayKey,chooseRequestExercise} from '../app/state.mjs';
import {createReport} from '../app/report.mjs';
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name)};
const session=(id='1')=>({id,exercise:'pushup',goal:10,actual:10,trackedFrames:80,source:'camera-estimate',endedAt:new Date().toISOString()});
check('User plan and reminders off',()=>{const s=defaultState();assert.deepEqual(s.plan,{pushup:10,squat:20,plank:60,pullup:1,boat:30,hang:30});assert.equal(s.reminder.enabled,false)});
check('Camera completion gives rewards once',()=>{const s=defaultState();assert.deepEqual(completeSession(s,session()),{added:true,coins:20,xp:50});assert.equal(completeSession(s,session()).added,false);assert.equal(s.coins,20);assert.equal(s.history.length,1)});
check('Same exercise today does not encourage grinding',()=>{const s=defaultState();completeSession(s,session());assert.equal(completeSession(s,session('2')).coins,0);assert.equal(s.coins,20)});
check('Next exercise and day reward independently',()=>{const s=defaultState();completeSession(s,session());assert.equal(chooseRequestExercise(s),'squat');completeSession(s,{...session('2'),exercise:'squat'});completeSession(s,{...session('3'),endedAt:new Date(Date.now()-86400000).toISOString()});assert.equal(s.coins,60)});
check('No completion from incomplete or missing camera evidence',()=>{for(const changed of [{actual:9},{trackedFrames:undefined},{trackedFrames:0},{goal:0},{actual:NaN},{source:'manual'},{exercise:'__proto__'},{endedAt:'no'}])assert.throws(()=>completeSession(defaultState(),{...session(),...changed}));});
check('Persisted rewards restored without double counting',()=>{const s=defaultState();completeSession(s,session());completeSession(s,session('2'));s.coins=9999;s.history.push(s.history[0]);const restored=loadState({getItem:()=>JSON.stringify(s)},'x');assert.equal(restored.coins,20);assert.equal(restored.history.length,2)});
check('Purchased color survives reload with correct balance',()=>{const s=defaultState();for(let n=0;n<5;n++)completeSession(s,{...session(String(n)),endedAt:new Date(Date.now()-n*86400000).toISOString()});s.coins-=80;s.owned.push('orange');s.theme='orange';const restored=loadState({getItem:()=>JSON.stringify(s)},'x');assert.equal(restored.coins,20);assert.equal(restored.theme,'orange')});
check('Bad storage recovers without enabling reminders',()=>assert.deepEqual(loadState({getItem:()=>'{bad'},'x'),defaultState()));
const freeSession=(id='free-1',exercise='pushup',actual=1)=>({...session(id),exercise,mode:'free',goal:null,actual});
check('Free sessions save below and above every former goal',()=>{
  for(const [exercise,actuals] of Object.entries({pushup:[1,3,11,80],squat:[1,7,21,100],plank:[1,2.75,61,240],pullup:[1,2,51]})){
    const s=defaultState();
    for(const [i,actual] of actuals.entries()){
      const reward=completeSession(s,freeSession(`${exercise}-${i}`,exercise,actual));
      assert.equal(reward.added,true);assert.equal(reward.coins,i===0?20:0);
      assert.equal(s.history.at(-1).actual,actual);assert.equal(s.history.at(-1).goal,null);assert.equal(s.history.at(-1).mode,'free');
    }
    assert.equal(s.coins,20);assert.equal(s.xp,50);
  }
});
check('Zero, fractional repetitions, invalid and untracked free results never earn rewards',()=>{
  for(const changed of [{actual:0},{actual:-1},{actual:.5},{actual:1.5},{actual:NaN},{actual:Infinity},{goal:10},{goal:undefined},{trackedFrames:0},{trackedFrames:2},{trackedFrames:NaN},{trackedFrames:undefined},{source:'manual'},{endedAt:undefined},{endedAt:'invalid'},{exercise:'__proto__'},{id:''},{id:null}]){
    const s=defaultState();assert.throws(()=>completeSession(s,{...freeSession(),...changed}));assert.equal(s.history.length,0);assert.equal(s.coins,0);assert.equal(s.xp,0);
  }
  for(const actual of [0,.9])assert.throws(()=>completeSession(defaultState(),freeSession('plank','plank',actual)));
});
check('Free sessions require explicit finish evidence before saving',()=>{
  const pending=freeSession();delete pending.endedAt;
  const s=defaultState();assert.throws(()=>completeSession(s,pending));assert.equal(s.history.length,0);
  pending.endedAt=new Date().toISOString();assert.equal(completeSession(s,pending).added,true);
});
check('Duplicate free session is saved and rewarded only once',()=>{
  const s=defaultState(),f=freeSession();completeSession(s,f);
  assert.deepEqual(completeSession(s,{...f,actual:20}),{added:false,coins:0,xp:0});
  assert.equal(s.history.length,1);assert.equal(s.history[0].actual,1);assert.equal(s.coins,20);assert.equal(s.xp,50);
});
check('Legacy and free sessions share first exercise per day reward rule',()=>{
  for(const firstFree of [true,false]){
    const s=defaultState();completeSession(s,firstFree?freeSession():session());
    const sameDay=firstFree?session('legacy-repeat'):freeSession('free-repeat');
    assert.deepEqual(completeSession(s,sameDay),{added:true,coins:0,xp:0});
    assert.deepEqual(completeSession(s,freeSession('another-exercise','squat',2)),{added:true,coins:20,xp:50});
    const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    assert.deepEqual(completeSession(s,{...freeSession('another-day'),endedAt:tomorrow.toISOString()}),{added:true,coins:20,xp:50});
    assert.equal(s.history.length,4);assert.equal(s.coins,60);assert.equal(s.xp,150);
  }
});
check('Mixed version1 history preserves modes, balances, colors, reminders and old plan',()=>{
  const s=defaultState();s.plan.pushup=14;s.plan.plank=75;s.sound=false;
  s.reminder={enabled:true,time:'07:00',days:[1,2,3,4,5,6,7],status:'scheduled'};
  for(let i=0;i<5;i++){
    const d=new Date();d.setDate(d.getDate()-i);
    completeSession(s,{...(i%2===0?session(`legacy-${i}`):freeSession(`free-${i}`,'pushup',3)),endedAt:d.toISOString()});
  }
  completeSession(s,freeSession('today-repeat','pushup',25));
  s.owned.push('orange');s.theme='orange';s.coins-=80;
  const restored=loadState({getItem:()=>JSON.stringify(s)},'arseniy-move-v1');
  assert.equal(restored.history.length,6);assert.deepEqual(restored.history,s.history);assert.equal(restored.coins,20);assert.equal(restored.xp,250);
  assert.deepEqual(restored.owned,['lime','orange']);assert.equal(restored.theme,'orange');assert.deepEqual(restored.reminder,s.reminder);assert.deepEqual(restored.plan,s.plan);assert.equal(restored.sound,false);
});
check('Loading filters invalid free and incomplete legacy results without phantom rewards',()=>{
  const valid=freeSession('valid');const s=defaultState();
  s.history=[valid,{...valid},{...session('unfinished'),actual:9},freeSession('zero','pushup',0),freeSession('fraction','squat',1.5),freeSession('subsecond','plank',.8),{...freeSession('untracked'),trackedFrames:0},{...freeSession('no-finish'),endedAt:undefined},{...freeSession('wrong-goal'),goal:10}];
  s.coins=999;s.xp=999;
  const restored=loadState({getItem:()=>JSON.stringify(s)},'arseniy-move-v1');
  assert.equal(restored.history.length,1);assert.equal(restored.history[0].id,'valid');assert.equal(restored.coins,20);assert.equal(restored.xp,50);
});
check('Demo free results remain excluded from production history',()=>{
  const s=defaultState();s.history=[{...freeSession(),demo:true}];
  assert.equal(loadState({getItem:()=>JSON.stringify(s)},'arseniy-move-v1').history.length,0);
  assert.equal(loadState({getItem:()=>JSON.stringify(s)},'preview').history.length,1);
});
check('Reports show only actual results and factual completion for free and legacy sessions',()=>{
  const originalDocument=globalThis.document;
  try{
    for(const s of [freeSession('rep','squat',7),freeSession('seconds','plank',2.75),session('legacy')]){
      const drawn=[];const c={fillRect(){},beginPath(){},roundRect(){},fill(){},arc(){},stroke(){},fillText(value){drawn.push(value);}};
      globalThis.document={createElement:()=>({getContext:()=>c})};createReport(s);
      assert.ok(drawn.includes(String(Math.floor(s.actual))));assert.ok(drawn.includes('ТРЕНИРОВКА'));assert.ok(drawn.includes('ЗАВЕРШЕНА'));
      assert.ok(!drawn.some(t=>t.includes(' / ')));assert.ok(!drawn.includes('ВЫПОЛНЕНО'));assert.ok(!drawn.includes('ЗАДАНИЕ'));
    }
  }finally{if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;}
});
check('Voice counter defaults on while legacy effect preference is preserved',()=>{
  const legacy={version:1,sound:false,history:[]};
  const restored=loadState({getItem:()=>JSON.stringify(legacy)},'arseniy-move-v1');
  assert.equal(restored.voiceCount,true);assert.equal(restored.muted,false);assert.equal(restored.sound,false);
});
check('Individual sound preferences and global mute survive reload without changing history',()=>{
  const s=defaultState();completeSession(s,freeSession('voice-history'));
  s.voiceCount=false;s.sound=true;s.muted=true;
  const restored=loadState({getItem:()=>JSON.stringify(s)},'arseniy-move-v1');
  assert.equal(restored.voiceCount,false);assert.equal(restored.sound,true);assert.equal(restored.muted,true);
  assert.equal(restored.history.length,1);assert.equal(restored.coins,20);assert.equal(restored.xp,50);
});
console.log(JSON.stringify({passed:checks}));
