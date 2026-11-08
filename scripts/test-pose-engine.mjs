import assert from 'node:assert/strict';
import {createTracker} from '../app/pose-engine.mjs';

// Constructed landmark sequences test the state machine, not real camera accuracy.
const sides={left:{shoulder:11,elbow:13,wrist:15,hip:23,knee:25,ankle:27},right:{shoulder:12,elbow:14,wrist:16,hip:24,knee:26,ankle:28}};
const point=(x,y)=>({x,y,z:0,visibility:.99,presence:.99});
const mid=(a,b)=>point((a.x+b.x)/2,(a.y+b.y)/2);
const clone=x=>JSON.parse(JSON.stringify(x));
function armElbow(shoulder,wrist,length,sign=1){const dx=wrist.x-shoulder.x,dy=wrist.y-shoulder.y,d=Math.hypot(dx,dy),h=Math.sqrt(Math.max(0,length*length-d*d/4));return point((shoulder.x+wrist.x)/2+sign*dy/d*h,(shoulder.y+wrist.y)/2-sign*dx/d*h);}
function blank(){return Array.from({length:33},()=>({x:.5,y:.5,z:0,visibility:0,presence:0}));}
function sidePose(joints){const result=blank();for(const [side,map] of Object.entries(sides))for(const [key,index] of Object.entries(map)){const p=joints[key];result[index]={...p,x:p.x+(side==='right'?.012:0),visibility:side==='right'?.96:.99,presence:.99};}return result;}
function pushup(amount=0){const shoulder=point(.26,.43+.10*amount),wrist=point(.26,.70),ankle=point(.85,.70),hip=mid(shoulder,ankle),knee=mid(hip,ankle),elbow=armElbow(shoulder,wrist,.135);return sidePose({shoulder,elbow,wrist,hip,knee,ankle});}
function squat(amount=0){const shoulder=point(.60-.13*amount,.22+.12*amount),hip=point(.60-.10*amount,.50+.14*amount),knee=point(.60+.10*amount,.70+.02*amount),ankle=point(.60,.90),elbow=point(.55,.40),wrist=point(.49,.50);return sidePose({shoulder,elbow,wrist,hip,knee,ankle});}
function plank(){return sidePose({shoulder:point(.25,.40),elbow:point(.25,.64),wrist:point(.44,.64),hip:point(.55,.52),knee:point(.70,.58),ankle:point(.85,.64)});}
function pullup(amount=0){const result=blank();for(const [side,map] of Object.entries(sides)){const left=side==='left',shoulder=point(left?.42:.58,.45-.14*amount),wrist=point(left?.34:.66,.13),elbow=armElbow(shoulder,wrist,.165,left?-1:1),hip=point(left?.44:.56,.70-.14*amount),knee=point(left?.44:.56,.81-.14*amount),ankle=point(left?.44:.56,.93-.14*amount);for(const [key,index] of Object.entries(map))result[index]={shoulder,wrist,elbow,hip,knee,ankle}[key];}return result;}
const poses={pushup,squat,pullup,plank};
function harness(exercise,transform=x=>x,cadence=50){const tracker=createTracker({exercise});let t=0,last;
  function frame(landmarks,step=cadence,extra={}){last=tracker.update({landmarks:transform(clone(landmarks)),timestamp:t,aspectRatio:1,...extra});t+=step;return last;}
  function hold(pose,ms=500){for(let i=0;i<=ms/cadence;i++)frame(pose);return last;}
  function ramp(factory,from,to,ms=900){const frames=Math.ceil(ms/cadence);for(let i=1;i<=frames;i++)frame(factory(from+(to-from)*i/frames));return last;}
  function rep(){hold(poses[exercise](0),500);ramp(poses[exercise],0,1,exercise==='pullup'?1000:900);hold(poses[exercise](1),300);ramp(poses[exercise],1,0,exercise==='pullup'?1000:900);hold(poses[exercise](0),350);return last;}
  return {tracker,frame,hold,ramp,rep,get last(){return last;},get time(){return t;},set time(value){t=value;}};
}
// Independently vary the estimated joint angle while retaining the same complete
// image-space body travel. These constructed estimates exercise threshold noise;
// they do not certify technique or reproduce a particular person's camera error.
function estimatedAnglePose(exercise,amount,angle,source='world'){
  const landmarks=poses[exercise](amount),worldLandmarks=clone(landmarks);
  const target=source==='world'?worldLandmarks:landmarks;
  for(const map of Object.values(sides)){
    const first=target[exercise==='squat'?map.hip:map.shoulder],last=target[exercise==='squat'?map.ankle:map.wrist];
    const length=Math.hypot(last.x-first.x,last.y-first.y)/(2*Math.sin(angle*Math.PI/360));
    target[exercise==='squat'?map.knee:map.elbow]=armElbow(first,last,length);
  }
  return {landmarks,...(source==='world'?{worldLandmarks}:{})};
}
function estimatedCycle(exercise,{top=170,bottom,source='world',cadence=125,noise=0,bodyScale=1,finalAmount=0,duration=2500}={}){
  const tracker=createTracker({exercise});let timestamp=0,last,sample=0;
  const frame=amount=>{const jitter=noise*Math.sin(++sample*1.7);last=tracker.update({...estimatedAnglePose(exercise,amount*bodyScale,top+(bottom-top)*amount+jitter,source),timestamp,aspectRatio:1});timestamp+=cadence;return last;};
  for(let t=0;t<=750;t+=cadence)frame(0);
  for(let t=cadence;t<=duration;t+=cadence)frame(Math.max(finalAmount,(1-Math.cos(2*Math.PI*t/duration))/2));
  for(let t=0;t<=750;t+=cadence)frame(finalAmount);
  return last;
}
const checks=[];
function test(name,fn){try{fn();checks.push(name);console.log('PASS '+name);}catch(error){console.error('FAIL '+name);throw error;}}

test('Unknown exercise is rejected',()=>assert.throws(()=>createTracker({exercise:'dance'}),TypeError));
for(const exercise of ['pushup','squat','pullup']){
  test(exercise+': complete stable cycles count exactly once',()=>{const h=harness(exercise);let r=h.rep();assert.equal(r.count,1,JSON.stringify(r));h.hold(poses[exercise](0),1200);assert.equal(h.last.count,1);r=h.rep();assert.equal(r.count,2,JSON.stringify(r));});
  test(exercise+': complete stable cycles count at the production 8 fps cadence',()=>{const h=harness(exercise,x=>x,125);assert.equal(h.rep().count,1,JSON.stringify(h.last));assert.equal(h.rep().count,2,JSON.stringify(h.last));});
  for(const cadence of [125,200,250,330])test(exercise+': continuous full movement counts at '+cadence+' ms without an endpoint hold',()=>{
    const h=harness(exercise,x=>x,cadence);h.hold(poses[exercise](0),700);
    const duration=exercise==='pullup'?2400:2000;
    for(let elapsed=cadence;elapsed<duration;elapsed+=cadence)h.frame(poses[exercise]((1-Math.cos(2*Math.PI*elapsed/duration))/2));
    h.frame(poses[exercise](0));
    assert.equal(h.last.count,1,JSON.stringify(h.last));
    h.hold(poses[exercise](0),700);assert.equal(h.last.count,1);
  });
  for(const cadence of [125,200,250,330])test(exercise+': three consecutive unpaused cycles count at '+cadence+' ms',()=>{
    const h=harness(exercise,x=>x,cadence);h.hold(poses[exercise](0),700);
    const duration=exercise==='pullup'?2400:2000;
    for(let elapsed=cadence;elapsed<=duration*3+cadence;elapsed+=cadence)h.frame(poses[exercise]((1-Math.cos(2*Math.PI*elapsed/duration))/2));
    assert.equal(h.last.count,3,JSON.stringify(h.last));
  });
  for(const duration of [1500,1800])for(const cadence of [125,250])test(exercise+': '+duration+' ms continuous movement at '+cadence+' ms sampling counts',()=>{
    const h=harness(exercise,x=>x,cadence);h.hold(poses[exercise](0),700);
    for(let elapsed=cadence;elapsed<duration;elapsed+=cadence)h.frame(poses[exercise]((1-Math.cos(2*Math.PI*elapsed/duration))/2));
    h.frame(poses[exercise](0));assert.equal(h.last.count,1,JSON.stringify(h.last));
  });
  test(exercise+': moderate visible landmarks count with variable 4–8 fps inference',()=>{
    const h=harness(exercise,l=>l.map(p=>({...p,visibility:.70,presence:.68})),125);h.hold(poses[exercise](0),700);
    const intervals=[125,230,180,310,145,265,190,300,125,230,180,260],duration=exercise==='pullup'?2700:2300;
    let elapsed=0,index=0;
    while(elapsed<duration){const delta=Math.min(intervals[index++%intervals.length],duration-elapsed);elapsed+=delta;h.time=h.time-125+delta;h.frame(poses[exercise]((1-Math.cos(2*Math.PI*elapsed/duration))/2));}
    assert.equal(h.last.count,1,JSON.stringify(h.last));
  });
  test(exercise+': starting in bent position is not a repetition',()=>{const h=harness(exercise);h.hold(poses[exercise](1),600);h.ramp(poses[exercise],1,0);h.hold(poses[exercise](0),500);assert.equal(h.last.count,0);});
  test(exercise+': half repetitions do not count',()=>{const h=harness(exercise);h.hold(poses[exercise](0));for(let n=0;n<3;n++){h.ramp(poses[exercise],0,.35);h.hold(poses[exercise](.35),350);h.ramp(poses[exercise],.35,0);h.hold(poses[exercise](0),500);}assert.equal(h.last.count,0);});
  test(exercise+': endpoint jumps and shaking cannot complete a rep',()=>{const h=harness(exercise);h.hold(poses[exercise](0));for(let i=0;i<20;i++)h.frame(poses[exercise](i%2?0:1));h.hold(poses[exercise](0));assert.equal(h.last.count,0);});
  test(exercise+': loss of tracking cancels a partial cycle',()=>{const h=harness(exercise);h.hold(poses[exercise](0));h.ramp(poses[exercise],0,1);h.hold(poses[exercise](1),350);h.frame([]);h.ramp(poses[exercise],1,0);h.hold(poses[exercise](0),500);assert.equal(h.last.count,0);assert.equal(h.rep().count,1);});
  test(exercise+': a frame gap cannot bridge a repetition',()=>{const h=harness(exercise);h.hold(poses[exercise](0));h.ramp(poses[exercise],0,1);h.hold(poses[exercise](1),350);h.time+=1500;assert.equal(h.frame(poses[exercise](1)).metrics.reason,'frame-gap');h.ramp(poses[exercise],1,0);h.hold(poses[exercise](0),500);assert.equal(h.last.count,0);});
  test(exercise+': missing confidence never counts',()=>{const h=harness(exercise,l=>l.map(p=>{delete p.visibility;delete p.presence;return p;}));assert.equal(h.rep().count,0);assert.equal(h.last.tracking,false);assert.equal(h.last.metrics.reason,'confidence');});
  test(exercise+': out-of-frame essentials never count',()=>{const key=exercise==='pullup'?'wrist':'ankle',h=harness(exercise,l=>{l[sides.left[key]].x=-.2;l[sides.right[key]].x=-.2;return l;});assert.equal(h.rep().count,0);assert.equal(h.last.metrics.reason,'out-of-frame');});
}
for(const exercise of ['pushup','squat'])for(const source of ['image','world']){
  const top=exercise==='pushup'?151:159,newBottom=exercise==='pushup'?115:112;
  test(exercise+': '+source+' estimate at the exercise-specific extended top still counts',()=>{
    const r=estimatedCycle(exercise,{top,bottom:newBottom-6,source});assert.equal(r.count,1,JSON.stringify(r));
  });
  test(exercise+': '+source+' estimate at the exercise-specific bottom still counts',()=>{
    const r=estimatedCycle(exercise,{bottom:newBottom-1,source});assert.equal(r.count,1,JSON.stringify(r));
  });
  for(const cadence of [125,250])test(exercise+': '+source+' small endpoint jitter counts once at '+cadence+' ms',()=>{
    const r=estimatedCycle(exercise,{top,bottom:newBottom-1,source,cadence,noise:.75});assert.equal(r.count,1,JSON.stringify(r));
  });
  test(exercise+': '+source+' repeated relaxed endpoints without transit cannot count',()=>{
    const tracker=createTracker({exercise});let timestamp=0,last;
    const frame=(amount,angle)=>{last=tracker.update({...estimatedAnglePose(exercise,amount,angle,source),timestamp,aspectRatio:1});timestamp+=250;};
    for(let i=0;i<5;i++)frame(0,top);
    for(let repeat=0;repeat<3;repeat++){
      for(let i=0;i<5;i++)frame(1,newBottom-1);
      for(let i=0;i<5;i++)frame(0,top);
    }
    assert.equal(last.count,0,JSON.stringify(last));
  });
  test(exercise+': '+source+' tolerance does not credit an implausibly short excursion',()=>{
    const r=estimatedCycle(exercise,{top,bottom:newBottom-1,source,duration:750});assert.equal(r.count,0,JSON.stringify(r));
  });
  test(exercise+': '+source+' bottom jitter cannot count without the return or duplicate it',()=>{
    const tracker=createTracker({exercise});let timestamp=0,last;
    const frame=(amount,angle)=>{last=tracker.update({...estimatedAnglePose(exercise,amount,angle,source),timestamp,aspectRatio:1});timestamp+=125;};
    for(let i=0;i<7;i++)frame(0,top);
    for(let i=1;i<=8;i++)frame(i/8,top+(newBottom-1-top)*i/8);
    for(let i=0;i<16;i++)frame(1,i%2?newBottom-1:120);
    assert.equal(last.count,0,JSON.stringify(last));
    for(let i=1;i<=8;i++)frame(1-i/8,newBottom-1+(top-newBottom+1)*i/8);
    for(let i=0;i<8;i++)frame(0,top+(i%2?.5:-.5));
    assert.equal(last.count,1,JSON.stringify(last));
  });
  test(exercise+': '+source+' insufficient extension outside tolerance cannot acquire start',()=>{
    const r=estimatedCycle(exercise,{top:top-2,bottom:newBottom-6,source});assert.equal(r.count,0,JSON.stringify(r));
  });
  test(exercise+': '+source+' partial depth outside tolerance does not count',()=>{
    const r=estimatedCycle(exercise,{bottom:newBottom+1,source});assert.equal(r.count,0,JSON.stringify(r));
  });
  test(exercise+': '+source+' angle tolerance cannot replace actual body travel',()=>{
    const r=estimatedCycle(exercise,{top,bottom:newBottom-1,source,bodyScale:.35});assert.equal(r.count,0,JSON.stringify(r));
  });
  test(exercise+': '+source+' stopping before the complete return does not count',()=>{
    const r=estimatedCycle(exercise,{top,bottom:newBottom-1,source,finalAmount:.15});assert.equal(r.count,0,JSON.stringify(r));
  });
}

for(const source of ['image','world'])for(const cadence of [125,250]){
  test('Pushup: previously missed endpoints count at '+cadence+' ms using '+source,()=>{
    const r=estimatedCycle('pushup',{top:153,bottom:114,source,cadence});assert.equal(r.count,1,JSON.stringify(r));
  });
  test('Squat: previously tolerated bent start is now rejected using '+source+' at '+cadence+' ms',()=>{
    const r=estimatedCycle('squat',{top:156,bottom:105,source,cadence});assert.equal(r.count,0,JSON.stringify(r));
  });
  test('Squat: previously tolerated shallow depth is now rejected using '+source+' at '+cadence+' ms',()=>{
    const r=estimatedCycle('squat',{top:170,bottom:116,source,cadence});assert.equal(r.count,0,JSON.stringify(r));
  });
}

test('Pushup: arm flexion without shoulder and hip travel is rejected',()=>{const h=harness('pushup');const fake=a=>{const l=pushup(0),arms=pushup(a);for(const map of Object.values(sides))l[map.elbow]=arms[map.elbow];return l;};h.hold(fake(0));h.ramp(fake,0,1);h.hold(fake(1),400);h.ramp(fake,1,0);h.hold(fake(0));assert.equal(h.last.count,0);});
test('Pushup: sloping projected floor still permits a full repetition',()=>{const h=harness('pushup',l=>l.map(p=>({...p,y:p.y-.30*(p.x-.5)})),250);assert.equal(h.rep().count,1,JSON.stringify(h.last));});
test('A long ready-position wait is not included in repetition duration',()=>{const h=harness('pushup',x=>x,125);h.hold(pushup(.03),20000);assert.equal(h.last.phase,'top');h.ramp(pushup,.03,1,900);h.ramp(pushup,1,.03,900);assert.equal(h.last.count,1,JSON.stringify(h.last));});
test('A fast full excursion cannot count by waiting longer at the returned top',()=>{const h=harness('pushup');h.hold(pushup(0));h.hold(pushup(.2),100);h.hold(pushup(1),250);h.hold(pushup(.2),100);assert.equal(h.frame(pushup(0)).count,0);h.hold(pushup(0),2000);assert.equal(h.last.count,0);});
test('An isolated deep-pose spike cannot replace the bottom of a partial repetition',()=>{const h=harness('squat');h.hold(squat(0));h.ramp(squat,0,.6);assert.equal(h.frame(squat(1)).metrics.reason,'pose-spike');h.ramp(squat,.6,0);h.hold(squat(0));assert.equal(h.last.count,0);});
test('Squat: moving camera / feet cancels a cycle',()=>{const h=harness('squat');h.hold(squat(0));h.ramp(squat,0,.5);const moved=squat(.6).map(p=>({...p,x:p.x+.17}));assert.equal(h.frame(moved).tracking,false);h.ramp(squat,.6,1);h.hold(squat(1));h.ramp(squat,1,0);h.hold(squat(0));assert.equal(h.last.count,0);});
for(const peak of [.70,.80,.90])for(const cadence of [125,250])test('Squat: comfortable full depth '+peak+' counts with world angles at '+cadence+' ms',()=>{
  const h=harness('squat',x=>x,cadence);
  const frame=amount=>{const landmarks=squat(amount);return h.frame(landmarks,cadence,{worldLandmarks:landmarks.map((p,index)=>({x:p.x-.5,y:p.y-.5,z:index%2?.02:-.02}))});};
  for(let elapsed=0;elapsed<=700;elapsed+=cadence)frame(0);
  let minimum=180;
  for(let elapsed=cadence;elapsed<=1500;elapsed+=cadence){const result=frame(peak*(1-Math.cos(2*Math.PI*elapsed/1500))/2);minimum=Math.min(minimum,result.metrics.kneeAngle);}
  assert.ok(minimum>=89&&minimum<=110,'Expected a comfortable 90–110 degree depth, got '+minimum);
  assert.equal(h.last.metrics.source,'world');assert.equal(h.last.count,1,JSON.stringify(h.last));
});
test('Pullup: bent arms without torso rise do not count',()=>{const fake=a=>{const l=pullup(a),standing=pullup(0);for(const map of Object.values(sides))for(const key of ['shoulder','hip','knee','ankle'])l[map[key]]=standing[map[key]];return l;};const h=harness('pullup');h.hold(fake(0));h.ramp(fake,0,1,1000);h.hold(fake(1),400);h.ramp(fake,1,0,1000);h.hold(fake(0));assert.equal(h.last.count,0);});
test('Pullup: moving wrists is not a valid anchored pull',()=>{const h=harness('pullup');h.hold(pullup(0));const fake=a=>pullup(a).map(p=>({...p,y:p.y-.1*a}));h.ramp(fake,0,1,1000);h.hold(fake(1));h.ramp(fake,1,0,1000);h.hold(fake(0));assert.equal(h.last.count,0);});
test('Pullup: both wrists need explicit high confidence',()=>{const h=harness('pullup',l=>{l[16].visibility=.2;return l;});assert.equal(h.rep().count,0);assert.equal(h.last.tracking,false);});
test('A good visible side remains selected when confidence scores flicker',()=>{const h=harness('pushup');h.hold(pushup(0));assert.equal(h.last.metrics.side,'left');const l=pushup(0);for(const i of Object.values(sides.left))l[i].visibility=.80;for(const i of Object.values(sides.right))l[i].visibility=.999;h.hold(l);assert.equal(h.last.metrics.side,'left');});
test('Switching visible sides cancels a cycle rather than stitching halves',()=>{const h=harness('pushup');h.hold(pushup(0));h.ramp(pushup,0,1);h.hold(pushup(1));const l=pushup(1);for(const i of Object.values(sides.left))l[i].visibility=.1;assert.equal(h.frame(l).metrics.reason,'side-change');h.ramp(pushup,1,0);h.hold(pushup(0));assert.equal(h.last.count,0);});
test('2-D angles use image aspect ratio',()=>{const a=harness('pushup'),b=harness('pushup');const raw=pushup(.6),wide=raw.map(p=>({...p,x:p.x/2}));const x=a.frame(raw),y=b.frame(wide,50,{aspectRatio:2});assert.ok(Math.abs(x.metrics.elbowAngle-y.metrics.elbowAngle)<.001);assert.ok(Math.abs(x.metrics.bodyLineAngle-y.metrics.bodyLineAngle)<.001);});
test('Valid world landmarks provide 3-D angles without bypassing image confidence',()=>{const h=harness('pushup'),raw=pushup(0),world=raw.map(p=>({x:p.x-.5,y:p.y-.5,z:0}));let r=h.frame(raw,50,{worldLandmarks:world});assert.equal(r.metrics.source,'world');const missing=raw.map(p=>({...p,visibility:undefined}));r=h.frame(missing,50,{worldLandmarks:world});assert.equal(r.tracking,false);assert.equal(r.count,0);});
test('World/image angle-source change cancels a partial cycle',()=>{const h=harness('pushup');h.hold(pushup(0));h.ramp(pushup,0,1);const raw=pushup(1),world=raw.map(p=>({x:p.x-.5,y:p.y-.5,z:0}));assert.equal(h.frame(raw,50,{worldLandmarks:world}).metrics.reason,'side-change');assert.equal(h.last.count,0);});
test('Plank requires a stable position before accumulating visible time',()=>{const h=harness('plank');h.hold(plank(),450);assert.equal(h.last.holdSeconds,0);h.frame(plank());assert.equal(h.last.phase,'holding');const before=h.last.holdSeconds;for(let i=0;i<20;i++)h.frame(plank());assert.equal(h.last.holdSeconds-before,1);assert.equal(h.last.metrics.continuousHoldSeconds,1);});
test('Plank pauses on invalid position and does not credit the dropout or recovery',()=>{const h=harness('plank');h.hold(plank(),1500);const before=h.last.holdSeconds;const invalid=plank();invalid[23].y=.23;invalid[24].y=.23;h.frame(invalid);assert.equal(h.last.tracking,false);assert.equal(h.last.holdSeconds,before);h.hold(plank(),450);assert.equal(h.last.holdSeconds,before);assert.equal(h.last.metrics.continuousHoldSeconds,0);});
test('Plank time cannot jump after a long frame gap',()=>{const h=harness('plank');h.hold(plank(),1500);const before=h.last.holdSeconds;h.time+=60000;assert.equal(h.frame(plank()).metrics.reason,'frame-gap');assert.equal(h.last.holdSeconds,before);h.hold(plank(),450);assert.equal(h.last.holdSeconds,before);});
test('Plank credits actual time at production 8 fps',()=>{const h=harness('plank',x=>x,125);h.hold(plank(),500);const before=h.last.holdSeconds;for(let i=0;i<8;i++)h.frame(plank());assert.equal(h.last.holdSeconds-before,1);});

test('Plank credits real intervals across variable 50–200 ms cadence',()=>{const h=harness('plank');h.hold(plank(),550);const before=h.last.holdSeconds;let elapsed=0;for(const delta of [50,125,200,80,150,75,180,100]){h.time=h.time-50+delta;h.frame(plank());elapsed+=delta;}assert.equal(h.last.holdSeconds-before,elapsed/1000);});

test('Plank never credits a 501 ms gap and must reacquire its position',()=>{const h=harness('plank');h.hold(plank(),1000);const before=h.last.holdSeconds;h.time+=451;const r=h.frame(plank());assert.equal(r.metrics.reason,'frame-gap');assert.equal(r.holdSeconds,before);assert.equal(r.metrics.continuousHoldSeconds,0);h.hold(plank(),450);assert.equal(h.last.holdSeconds,before);});
test('Plank works with visible moderate-confidence joints and 3–5 fps inference',()=>{const h=harness('plank',l=>l.map(p=>({...p,visibility:.70,presence:.68})),250);h.hold(plank(),750);const before=h.last.holdSeconds;let elapsed=0;for(const delta of [250,330,280,400,220]){h.time=h.time-250+delta;h.frame(plank());elapsed+=delta;}assert.equal(h.last.holdSeconds-before,elapsed/1000);assert.equal(h.last.metrics.frameIntervalMs,220);assert.equal(h.last.metrics.sampleHz,4.545);});
test('Plank lying flat without visible raised support never counts',()=>{const h=harness('plank');const flat=sidePose({shoulder:point(.25,.62),elbow:point(.25,.64),wrist:point(.44,.64),hip:point(.55,.63),knee:point(.70,.635),ankle:point(.85,.64)});h.hold(flat,3000);assert.equal(h.last.holdSeconds,0);assert.equal(h.last.tracking,false);});
test('Plank: a sloping projected floor is valid but lying on it is not',()=>{const skew=l=>l.map(p=>({...p,y:p.y-.30*(p.x-.5)}));const h=harness('plank',skew,250);h.hold(plank(),1750);assert.ok(h.last.holdSeconds>=1,JSON.stringify(h.last));const flat=sidePose({shoulder:point(.25,.62),elbow:point(.25,.64),wrist:point(.44,.64),hip:point(.55,.63),knee:point(.70,.635),ankle:point(.85,.64)});const invalid=harness('plank',skew,250);invalid.hold(flat,2000);assert.equal(invalid.last.holdSeconds,0);assert.equal(invalid.last.tracking,false);});
test('Plank rejects missing confidence and partial body',()=>{const h=harness('plank');const missing=plank().map(p=>{delete p.visibility;return p;});h.hold(missing,3000);assert.equal(h.last.holdSeconds,0);h.hold(plank().slice(0,20),3000);assert.equal(h.last.holdSeconds,0);});
test('Plank straight-arm support is also valid',()=>{const h=harness('plank');const high=plank();for(const map of Object.values(sides)){high[map.elbow]={...high[map.shoulder],y:.52};high[map.wrist]={...high[map.shoulder],y:.64};}h.hold(high,1500);assert.ok(h.last.holdSeconds>=.9,JSON.stringify(h.last));});
test('Repeated / backward timestamps do not earn time',()=>{const h=harness('plank');h.hold(plank(),1500);const before=h.last.holdSeconds;let r=h.tracker.update({landmarks:plank(),timestamp:h.time-100,aspectRatio:1});assert.equal(r.holdSeconds,before);assert.equal(r.metrics.reason,'timestamp');r=h.tracker.update({landmarks:plank(),timestamp:NaN,aspectRatio:1});assert.equal(r.holdSeconds,before);assert.equal(r.tracking,false);});
test('Hidden document pauses counting immediately',()=>{const h=harness('plank');h.hold(plank(),1000);const before=h.last.holdSeconds;globalThis.document={hidden:true};try{h.frame(plank());assert.equal(h.last.metrics.reason,'hidden');assert.equal(h.last.holdSeconds,before);}finally{delete globalThis.document;}});
test('pause preserves totals, clears partial movement and reset clears totals',()=>{const h=harness('pushup');h.rep();let r=h.tracker.pause();assert.equal(r.count,1);assert.equal(r.phase,'paused');h.hold(pushup(1));h.ramp(pushup,1,0);h.hold(pushup(0));assert.equal(h.last.count,1);r=h.tracker.reset();assert.equal(r.count,0);assert.equal(r.holdSeconds,0);assert.equal(r.phase,'setup');});
test('Malformed input produces finite unchanged totals rather than exceptions',()=>{const h=harness('squat');for(const input of [{},{landmarks:[],timestamp:0,aspectRatio:1},{landmarks:squat(0),timestamp:50,aspectRatio:0},{landmarks:squat(0),timestamp:100,aspectRatio:NaN}]){const r=h.tracker.update(input);assert.equal(r.count,0);assert.equal(r.holdSeconds,0);assert.equal(r.tracking,false);}});

console.log(JSON.stringify({passed:true,syntheticOnly:true,checks:checks.length,exercises:['pushup','squat','plank','pullup'],physicalAccuracyValidated:false},null,2));
