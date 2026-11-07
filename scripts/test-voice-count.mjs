import assert from 'node:assert/strict';
import {createVoiceCounter,secondsPhrase} from '../app/voice-count.mjs';

let checks=0;
function check(name,run){run();checks++;console.log('PASS',name);}
function nativeFixture(){
  const events=[],statuses=[];
  const native={prepareCounterSpeech(){events.push({type:'prepare'});},speakCounter(text){events.push({type:'speak',text});},stopCounterSpeech(){events.push({type:'stop'});}};
  const controller=createVoiceCounter({getNative:()=>native,getSynthesis:()=>{throw new Error('Native must not use browser');},onStatus:value=>statuses.push(value)});
  return {controller,native,events,statuses,spoken:()=>events.filter(e=>e.type==='speak').map(e=>e.text)};
}
const localRu={name:'Local Russian',lang:'ru-RU',localService:true};
const remoteRu={name:'Remote Russian',lang:'ru-RU',localService:false};
function browserFixture(initialVoices=[localRu]){
  const events=[],statuses=[];let voices=initialVoices;
  class Utterance{constructor(text){this.text=text;}}
  const synth={getVoices:()=>voices,cancel(){events.push({type:'cancel'});},speak(utterance){events.push({type:'speak',utterance});}};
  const controller=createVoiceCounter({getNative:()=>null,getSynthesis:()=>synth,getUtterance:()=>Utterance,onStatus:value=>statuses.push(value)});
  return {controller,synth,events,statuses,setVoices:value=>{voices=value;},utterances:()=>events.filter(e=>e.type==='speak').map(e=>e.utterance),spoken:()=>events.filter(e=>e.type==='speak').map(e=>e.utterance.text)};
}

check('Every repetition exercise announces newly counted integers only',()=>{
  for(const exercise of ['pushup','squat','pullup']){
    const f=nativeFixture();f.controller.start(exercise);
    for(const value of [0,0,1,1,1.2,2,2,3])f.controller.update(value);
    assert.deepEqual(f.spoken(),['1','2','3']);
  }
});
check('Counts have no previous exercise goals or upper limit',()=>{
  const f=nativeFixture();f.controller.start('squat',19);f.controller.update(20);f.controller.update(21);f.controller.update(100);
  assert.deepEqual(f.spoken(),['20','21','100']);
});
check('Initial value, duplicates, decreases and invalid values never replay',()=>{
  const f=nativeFixture();f.controller.start('pushup',5);
  for(const value of [5,4,0,5,-1,NaN,Infinity,undefined])f.controller.update(value);
  assert.deepEqual(f.spoken(),[]);f.controller.update(6);assert.deepEqual(f.spoken(),['6']);
});
check('A jump announces the latest count without creating a speech backlog',()=>{
  const f=nativeFixture();f.controller.start('squat');f.controller.update(4);f.controller.update(7);
  assert.deepEqual(f.spoken(),['4','7']);
});
check('Plank announces elapsed ten-second boundaries without a minute goal',()=>{
  const f=nativeFixture();f.controller.start('plank');
  for(const value of [0,1,9.9,10,10.8,19.9,20,20,60,61,69,70,120])f.controller.update(value);
  assert.deepEqual(f.spoken(),['10 секунд','20 секунд','60 секунд','70 секунд','120 секунд']);
});
check('Plank skips elapsed boundaries during mute and after resuming',()=>{
  const f=nativeFixture();f.controller.start('plank',28);f.controller.update(30);f.controller.configure(false);f.controller.update(40);f.controller.update(50);f.controller.configure(true);f.controller.update(50);
  f.controller.pause();f.controller.resume('plank',65);f.controller.update(65);f.controller.update(70);
  assert.deepEqual(f.spoken(),['30 секунд','70 секунд']);
});
check('Muted updates preserve the active session and advance its watermark',()=>{
  const f=nativeFixture();f.controller.start('pushup');f.controller.update(1);f.controller.configure(false);f.controller.update(2);f.controller.update(3);f.controller.configure(true);f.controller.update(3);f.controller.update(4);
  assert.deepEqual(f.spoken(),['1','4']);
});
check('Lost tracking suppresses new counts without interrupting the previous phrase',()=>{
  const f=nativeFixture();f.controller.start('pushup');f.controller.update(1);const stops=f.events.filter(e=>e.type==='stop').length;
  f.controller.update(1,false);f.controller.update(2,false);assert.equal(f.events.filter(e=>e.type==='stop').length,stops);
  f.controller.update(2,true);f.controller.update(3,true);assert.deepEqual(f.spoken(),['1','3']);
});
check('Pause and resume cancel speech and do not announce the existing value',()=>{
  const f=nativeFixture();f.controller.start('squat');f.controller.update(1);f.controller.pause();assert.equal(f.events.at(-1).type,'stop');
  f.controller.update(2);f.controller.resume('squat',2);f.controller.update(2);f.controller.update(3);
  assert.deepEqual(f.spoken(),['1','3']);
});
check('Stop ends a session; a different exercise starts from its own baseline',()=>{
  const f=nativeFixture();f.controller.start('pushup');f.controller.update(1);f.controller.stop();f.controller.update(2);
  f.controller.start('pullup',0);f.controller.update(1);assert.deepEqual(f.spoken(),['1','1']);
});
check('Unknown exercise never starts automatic speech',()=>{
  const f=nativeFixture();f.controller.start('unknown');f.controller.update(1);assert.deepEqual(f.spoken(),[]);assert.equal(f.events.filter(e=>e.type==='prepare').length,0);
});
check('Explicit voice test prepares the engine and respects mute',()=>{
  const f=nativeFixture();assert.equal(f.controller.test(),true);assert.deepEqual(f.spoken(),['Проверка голоса. Один, два, три.']);
  assert.equal(f.events.filter(e=>e.type==='prepare').length,1);f.controller.configure(false);assert.equal(f.controller.test(),false);assert.equal(f.spoken().length,1);
});
check('Voice test leaves the current count unchanged',()=>{
  const f=nativeFixture();f.controller.start('pushup',4);f.controller.test();f.controller.update(4);f.controller.update(5);
  assert.deepEqual(f.spoken(),['Проверка голоса. Один, два, три.','5']);
});
check('Native errors report unavailability instead of silently using browser speech',()=>{
  const f=nativeFixture();f.native.speakCounter=()=>{throw new Error('native unavailable');};f.controller.start('pushup');assert.equal(f.controller.update(1),false);assert.equal(f.controller.status.state,'unavailable');assert.match(f.controller.status.message,/голос/);
  f.native.prepareCounterSpeech=()=>{throw new Error('native init failed');};assert.equal(f.controller.test(),false);assert.equal(f.controller.status.state,'unavailable');
});
check('Native statuses can be delivered as objects or JSON strings',()=>{
  const f=nativeFixture(),observed=[];f.controller.setOnStatus(s=>observed.push(s));assert.equal(observed[0].state,'idle');
  assert.equal(f.controller.acceptStatus({state:'initializing',available:false,message:'Подготовка',offline:true}),true);
  assert.equal(f.controller.acceptStatus(JSON.stringify({state:'ready',available:true,message:'Готов',offline:true,language:'ru-RU'})),true);
  assert.deepEqual(f.controller.status,{state:'ready',available:true,message:'Готов',offline:true,language:'ru-RU'});
  const copy=f.controller.status;copy.state='bad';assert.equal(f.controller.status.state,'ready');
  assert.equal(f.controller.acceptStatus('not JSON'),false);assert.equal(f.controller.acceptStatus({state:'bad'}),false);assert.equal(f.controller.acceptStatus(null),false);
});
check('Browser fallback chooses a local Russian voice and cancels before new speech',()=>{
  const f=browserFixture([remoteRu,{name:'English',lang:'en-US',localService:true},localRu]);f.controller.start('pushup');f.controller.update(1);f.controller.update(2);
  assert.deepEqual(f.spoken(),['1','2']);for(const utterance of f.utterances()){assert.equal(utterance.lang,'ru-RU');assert.equal(utterance.voice,localRu);assert.equal(utterance.volume,1);}
  for(let i=0;i<f.events.length;i++)if(f.events[i].type==='speak')assert.equal(f.events[i-1].type,'cancel');
  assert.equal(f.controller.status.offline,true);
});
check('Browser with remote-only Russian voice does not use a network voice',()=>{
  const f=browserFixture([remoteRu]);f.controller.start('squat');f.controller.update(1);assert.equal(f.controller.test(),false);
  assert.deepEqual(f.spoken(),[]);assert.equal(f.controller.status.state,'unavailable');assert.equal(f.controller.status.available,false);assert.match(f.controller.status.message,/локальный русский/);
});
check('An empty browser voice list waits without implicit or default speech',()=>{
  const f=browserFixture([]);f.controller.start('pushup');f.controller.update(1);assert.equal(f.controller.test(),false);
  assert.deepEqual(f.spoken(),[]);assert.equal(f.controller.status.state,'initializing');assert.equal(f.controller.status.available,false);
  f.setVoices([localRu]);assert.equal(f.controller.test(),true);f.controller.update(1);f.controller.update(2);
  assert.deepEqual(f.spoken(),['Проверка голоса. Один, два, три.','2']);
});
check('Browser with only other languages reports unavailable',()=>{
  const f=browserFixture([{name:'English',lang:'en-US',localService:true}]);f.controller.start('pushup');assert.equal(f.controller.update(1),false);assert.equal(f.controller.status.state,'unavailable');assert.deepEqual(f.spoken(),[]);
});
check('No browser synthesis support is a recoverable availability status',()=>{
  const f=createVoiceCounter({getNative:()=>null,getSynthesis:()=>null,getUtterance:()=>null});assert.doesNotThrow(()=>f.start('pushup'));assert.equal(f.update(1),false);assert.equal(f.status.state,'unavailable');
});
check('Stale browser callbacks cannot overwrite a current speech status',()=>{
  const f=browserFixture();f.controller.start('pushup');f.controller.update(1);const old=f.utterances()[0];f.controller.update(2);const current=f.utterances()[1];
  current.onstart();old.onerror({error:'synthesis-failed'});assert.equal(f.controller.status.state,'ready');
  current.onerror({error:'synthesis-failed'});assert.equal(f.controller.status.state,'unavailable');
});
check('Browser cancellation, pause and mute ignore late or interrupted errors',()=>{
  const f=browserFixture();f.controller.start('squat');f.controller.update(1);const first=f.utterances()[0];f.controller.pause();first.onerror({error:'synthesis-failed'});assert.equal(f.controller.status.state,'ready');
  f.controller.resume('squat',1);f.controller.update(2);const second=f.utterances()[1];second.onerror({error:'interrupted'});assert.equal(f.controller.status.state,'ready');
  f.controller.configure(false);second.onerror({error:'synthesis-failed'});assert.equal(f.controller.status.state,'ready');
});
check('Natural Russian seconds declension handles teens and hundreds',()=>{
  for(const [value,expected] of [[0,'0 секунд'],[1,'1 секунда'],[2,'2 секунды'],[5,'5 секунд'],[11,'11 секунд'],[14,'14 секунд'],[21,'21 секунда'],[22,'22 секунды'],[25,'25 секунд'],[101,'101 секунда'],[111,'111 секунд'],[120,'120 секунд']])assert.equal(secondsPhrase(value),expected);
});

console.log(JSON.stringify({passed:checks,realAudioUsed:false}));
