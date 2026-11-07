import assert from 'node:assert/strict';
import {trainingProgress,formatTime} from '../app/progress.mjs';
import {defaultState,completeSession,loadState} from '../app/state.mjs';
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS',name);};
const now=new Date(2026,10,7,20);
const record=(id,day,extra={})=>({id,exercise:'pushup',mode:'free',goal:null,actual:3,trackedFrames:10,source:'camera-estimate',startedAt:new Date(2026,10,day,10).toISOString(),endedAt:new Date(2026,10,day,10,2).toISOString(),...extra});
check('Empty history has neither phantom missed days nor a streak',()=>{
  const p=trainingProgress([],{now});assert.equal(p.rows.length,7);assert.equal(p.missedDays,0);assert.equal(p.currentStreak,0);assert.equal(p.bestStreak,0);assert.equal(p.rows.at(-1).status,'today');
});
check('Repeated sets count as volume but only one training day',()=>{
  const p=trainingProgress([record('1',7),record('2',7),record('3',7,{exercise:'plank',actual:21.5})],{now});
  assert.equal(p.sets,3);assert.equal(p.activeDays,1);assert.equal(p.seconds,360);assert.equal(p.currentStreak,1);assert.deepEqual(p.rows.at(-1).exercises,{pushup:6,plank:21.5});
});
check('Today remains pending and preserves the series through yesterday',()=>{
  const p=trainingProgress([record('1',5),record('2',6)],{now});assert.equal(p.currentStreak,2);assert.equal(p.missedDays,0);assert.equal(p.rows.at(-1).status,'today');
});
check('A completed gap breaks current series; best series is retained',()=>{
  const p=trainingProgress([record('1',2),record('2',3),record('3',5)],{now});assert.equal(p.currentStreak,0);assert.equal(p.bestStreak,2);assert.equal(p.missedDays,2);
});
check('Today can restart a series after a missed day',()=>{
  assert.equal(trainingProgress([record('1',5),record('2',7)],{now}).currentStreak,1);
});
check('Dates before first saved workout are not missed days',()=>{
  const p=trainingProgress([record('1',6)],{now,days:30});assert.equal(p.missedDays,0);assert.equal(p.rows.filter(r=>r.status==='before').length,28);
});
check('Series crosses months and is not truncated by selected range',()=>{
  const history=Array.from({length:12},(_,i)=>record(`${i}`,7-i));
  const p=trainingProgress(history,{now});assert.equal(p.currentStreak,12);assert.equal(p.bestStreak,12);assert.equal(p.activeDays,7);assert.equal(p.totalDays,12);assert.equal(p.rows[0].key,'2026-11-01');
});
check('Thirty days cross year and leap-day boundaries',()=>{
  const p=trainingProgress([],{now:new Date(2027,0,5),days:30});assert.equal(p.rows[0].key,'2026-12-07');
  assert.ok(trainingProgress([],{now:new Date(2028,2,1),days:7}).rows.some(r=>r.key==='2028-02-29'));
});
check('Local midnight determines the day, not the UTC date',()=>{
  const endedAt=new Date(2026,10,7,0,5).toISOString();
  const p=trainingProgress([record('1',6,{endedAt})],{now});assert.equal(p.rows.at(-1).sets,1);
});
check('Duplicate, zero, incomplete, untracked and future records are excluded',()=>{
  const good=record('ok',7);
  const p=trainingProgress([good,good,record('zero',7,{actual:0}),record('bad',7,{endedAt:'bad'}),record('untracked',7,{trackedFrames:0}),record('future',8),record('later',7,{endedAt:new Date(2026,10,7,23).toISOString()}),record('legacy',7,{mode:undefined,goal:10,actual:3})],{now});
  assert.equal(p.sets,1);assert.equal(p.activeDays,1);
});
check('Unknown duration is not guessed from repetition count or hold seconds',()=>{
  const p=trainingProgress([record('1',7,{startedAt:undefined,exercise:'hang',actual:40})],{now});assert.equal(p.seconds,0);assert.equal(p.unknownDuration,1);assert.equal(p.activeDays,1);
});
check('Stored duration and timestamp fallback work with invalid duration fields',()=>{
  const p=trainingProgress([record('1',7,{durationSeconds:30}),record('2',7,{durationSeconds:-1}),record('3',7,{startedAt:'bad',durationSeconds:null})],{now});assert.equal(p.seconds,150);assert.equal(p.unknownDuration,1);
});
check('Legacy and free history, rewards and settings remain unchanged after analysis',()=>{
  const s=defaultState();completeSession(s,record('legacy',6,{mode:undefined,goal:10,actual:10}));completeSession(s,record('free',7));s.sound=false;s.reminder.enabled=true;
  const restored=loadState({getItem:()=>JSON.stringify(s)},'arseniy-move-v1');
  const before=JSON.stringify(restored);const p=trainingProgress(restored.history,{now});assert.equal(JSON.stringify(restored),before);assert.equal(p.sets,2);assert.equal(restored.coins,40);assert.equal(restored.xp,100);assert.equal(restored.sound,false);assert.equal(restored.reminder.enabled,true);
});
check('Sub-minute time does not round up or disappear',()=>{assert.equal(formatTime(29),'29 с');assert.equal(formatTime(61),'1 мин 1 с');});
check('Calendar day increments survive DST transitions',()=>{
  const history=[7,8,9].map(d=>record(String(d),1,{endedAt:new Date(2026,2,d,12).toISOString()}));
  assert.equal(trainingProgress(history,{now:new Date(2026,2,9,20)}).currentStreak,3);
  const fall=[31,32,33].map(d=>record(String(d),1,{endedAt:new Date(2026,9,d,12).toISOString()}));
  assert.equal(trainingProgress(fall,{now:new Date(2026,10,2,20)}).currentStreak,3);
});
console.log(JSON.stringify({passed:checks,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}));
