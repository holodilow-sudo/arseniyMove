import assert from 'node:assert/strict';
import {createTracker} from '../app/pose-engine.mjs';
import {createVoiceCounter} from '../app/voice-count.mjs';
import {defaultState,completeSession,loadState} from '../app/state.mjs';
function pose(raised=true){const a=Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0,presence:0}));const xy=[[.4,.55],[.28,.51],[.16,.47],[.55,.6],[.7,.56],[.85,.52]];for(const ids of [[11,13,15,23,25,27],[12,14,16,24,26,28]])ids.forEach((id,i)=>a[id]={x:xy[i][0],y:raised?xy[i][1]:.6,z:0,visibility:.99,presence:.99});return a;}
const t=createTracker({exercise:'boat'});let r;for(let timestamp=0;timestamp<=2000;timestamp+=100)r=t.update({timestamp,aspectRatio:1,landmarks:pose()});assert(r.holdSeconds>=1);const before=r.holdSeconds;
for(let timestamp=2100;timestamp<=3000;timestamp+=100)r=t.update({timestamp,aspectRatio:1,landmarks:pose(false)});assert.equal(r.holdSeconds,before);assert.equal(r.tracking,false);
t.pause();r=t.update({timestamp:5000,aspectRatio:1,landmarks:pose()});assert.equal(r.holdSeconds,before);
const spoken=[];const v=createVoiceCounter({getNative:()=>({prepareCounterSpeech(){},stopCounterSpeech(){},speakCounter(s){spoken.push(s)}})});v.start('boat');v.update(9);v.update(10);v.update(10);v.update(20);assert.deepEqual(spoken,['10 секунд','20 секунд']);
const state=defaultState();completeSession(state,{id:'boat',exercise:'boat',actual:12.3,mode:'free',goal:null,trackedFrames:20,source:'camera-estimate',endedAt:new Date().toISOString()});assert.equal(loadState({getItem:()=>JSON.stringify(state)},'test').history[0].actual,12.3);
console.log('Boat hold, lowered pose, gap/pause, spoken seconds, fractional history PASS');
const gentle=pose();for(const p of gentle)p.y=.6+(p.y-.6)*.15;
const u=createTracker({exercise:'boat'});let q;for(let timestamp=0;timestamp<=2000;timestamp+=100)q=u.update({timestamp,aspectRatio:1,landmarks:gentle});assert(q.holdSeconds>=1,'small lift accepted');
const held=q.holdSeconds;const obscured=pose();for(const p of obscured)p.visibility=.2;
q=u.update({timestamp:2100,aspectRatio:1,landmarks:obscured});assert.equal(q.holdSeconds,held);
q=u.update({timestamp:2200,aspectRatio:1,landmarks:gentle});assert.equal(q.phase,'holding');assert.equal(q.holdSeconds,held);
q=u.update({timestamp:2300,aspectRatio:1,landmarks:gentle});assert(q.holdSeconds>held);
for(let timestamp=2400;timestamp<=3200;timestamp+=100)q=u.update({timestamp,aspectRatio:1,landmarks:obscured});
q=u.update({timestamp:3300,aspectRatio:1,landmarks:gentle});assert.equal(q.phase,'setup','long loss requires reacquisition');
const flat=createTracker({exercise:'boat'});for(let timestamp=0;timestamp<=3000;timestamp+=100)q=flat.update({timestamp,aspectRatio:1,landmarks:pose(false)});assert.equal(q.holdSeconds,0);
console.log('Gentle lift, bounded dropout, no unobserved time, no flat-pose credit PASS');

