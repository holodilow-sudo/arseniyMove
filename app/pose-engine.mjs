/**
 * Conservative, deterministic movement tracking over one MediaPipe pose.
 * This is a motion heuristic, not certified technique or identity verification.
 * No camera, networking, storage, timers, or landmark history outside this instance.
 */
const SIDES = Object.freeze({
  left: { shoulder:11, elbow:13, wrist:15, hip:23, knee:25, ankle:27 },
  right:{ shoulder:12, elbow:14, wrist:16, hip:24, knee:26, ankle:28 }
});
const EXERCISES = new Set(['pushup','squat','plank','pullup','boat','hang']);
const LIMITS = Object.freeze({
  confidence:0.65, presence:0.60, frameMargin:0.015,
  maxFrameGap:500, startDwell:350,
  minDwellFrames:2, plankDwell:500, minRepMs:900, minPullupMs:1200,
  maxRepMs:15000, maxJointStep:0.65,
  topEnter:158, topExit:146, lowEnter:105, lowExit:119
});
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:((a.z||0)+(b.z||0))/2});
const deg=(a,b,c)=>{
  const u={x:a.x-b.x,y:a.y-b.y,z:(a.z||0)-(b.z||0)},v={x:c.x-b.x,y:c.y-b.y,z:(c.z||0)-(b.z||0)};
  const lengths=Math.hypot(u.x,u.y,u.z)*Math.hypot(v.x,v.y,v.z);
  return lengths<1e-8?NaN:Math.acos(clamp((u.x*v.x+u.y*v.y+u.z*v.z)/lengths,-1,1))*180/Math.PI;
};
const normalizedPoint=(p,aspect)=>({x:p.x*aspect,y:p.y,z:0});
// A floor projects to a sloping line when the phone is not perfectly side-on.
// Compare body height with that line, not the wrist/ankle image Y coordinates.
const supportHeight=(point,support,foot)=>{
  const dx=foot.x-support.x,dy=foot.y-support.y,length=Math.hypot(dx,dy);
  return length>1e-6&&Math.abs(dx)>1e-6?((point.x-support.x)*dy-(point.y-support.y)*dx)*Math.sign(dx)/length:NaN;
};
const confidence=p=>finite(p?.visibility)?Math.min(p.visibility,finite(p.presence)?p.presence:1):0;
const pointValid=p=>p&&finite(p.x)&&finite(p.y)&&finite(p.visibility)&&p.visibility>=LIMITS.confidence&&p.visibility<=1&&(!('presence' in p)||(finite(p.presence)&&p.presence>=LIMITS.presence&&p.presence<=1));
const inFrame=p=>p.x>=LIMITS.frameMargin&&p.x<=1-LIMITS.frameMargin&&p.y>=LIMITS.frameMargin&&p.y<=1-LIMITS.frameMargin;
const rounded=n=>finite(n)?Math.round(n*1000)/1000:null;

function selectedKeys(exercise){return exercise==='squat'?['shoulder','hip','knee','ankle']:['shoulder','elbow','wrist','hip','knee','ankle'];}
function inspectSide(landmarks,side,exercise,aspect,worldLandmarks){
  const indices=SIDES[side],keys=selectedKeys(exercise);
  const points=keys.map(key=>landmarks[indices[key]]);
  if(points.some(p=>!pointValid(p)))return {valid:false,reason:'confidence'};
  if(points.some(p=>!inFrame(p)))return {valid:false,reason:'out-of-frame'};
  const image=Object.fromEntries(keys.map(key=>[key,normalizedPoint(landmarks[indices[key]],aspect)]));
  const torso=distance(image.shoulder,image.hip),leg=distance(image.hip,image.knee)+distance(image.knee,image.ankle);
  if(torso<0.075||leg<0.12||torso>0.95||leg>1.6)return {valid:false,reason:'body-size'};
  if(distance(image.hip,image.knee)<0.035||distance(image.knee,image.ankle)<0.035)return {valid:false,reason:'geometry'};
  if(image.elbow&&(distance(image.shoulder,image.elbow)<torso*0.15||distance(image.elbow,image.wrist)<torso*0.15))return {valid:false,reason:'geometry'};
  // Normalized landmarks determine confidence/in-frame status even when 3-D angles are used.
  let coords=image,source='image';
  if(Array.isArray(worldLandmarks)&&keys.every(key=>{const p=worldLandmarks[indices[key]];return p&&finite(p.x)&&finite(p.y)&&finite(p.z);})){ 
    const candidate=Object.fromEntries(keys.map(key=>{const p=worldLandmarks[indices[key]];return [key,{x:p.x,y:p.y,z:p.z}];}));
    const t=distance(candidate.shoulder,candidate.hip),thigh=distance(candidate.hip,candidate.knee),shin=distance(candidate.knee,candidate.ankle);
    const armOkay=!candidate.elbow||(distance(candidate.shoulder,candidate.elbow)>0.035&&distance(candidate.elbow,candidate.wrist)>0.035);
    if(t>=0.10&&t<=1.05&&thigh>=0.055&&thigh<=1.2&&shin>=0.055&&shin<=1.2&&armOkay){coords=candidate;source='world';}
  }
  const knee=deg(coords.hip,coords.knee,coords.ankle),hip=deg(coords.shoulder,coords.hip,coords.knee),line=deg(coords.shoulder,coords.hip,coords.ankle),elbow=coords.elbow?deg(coords.shoulder,coords.elbow,coords.wrist):null;
  if(!finite(knee)||!finite(hip)||!finite(line)||(coords.elbow&&!finite(elbow)))return {valid:false,reason:'geometry'};
  return {valid:true,side,source,image,torso,leg,knee,hip,line,elbow,confidence:Math.min(...points.map(confidence)),score:points.reduce((s,p)=>s+confidence(p),0)/points.length};
}

function bodyMeasurement(input,exercise,oldSide){
  const {landmarks,worldLandmarks}=input,aspect=input.aspectRatio;
  if(!finite(aspect)||aspect<0.25||aspect>4)return {valid:false,reason:'aspect-ratio'};
  if(!Array.isArray(landmarks)||landmarks.length<33)return {valid:false,reason:'no-pose'};
  const l=inspectSide(landmarks,'left',exercise,aspect,worldLandmarks),r=inspectSide(landmarks,'right',exercise,aspect,worldLandmarks);
  if(exercise==='pullup'||exercise==='hang'){
    if(!l.valid||!r.valid)return {valid:false,reason:!l.valid?l.reason:r.reason};
    if(l.source!==r.source)return {valid:false,reason:'geometry'};
    const image={};for(const key of selectedKeys(exercise))image[key]=midpoint(l.image[key],r.image[key]);
    return {valid:true,side:'both',source:l.source,image,torso:(l.torso+r.torso)/2,leg:(l.leg+r.leg)/2,knee:(l.knee+r.knee)/2,hip:(l.hip+r.hip)/2,line:(l.line+r.line)/2,elbow:(l.elbow+r.elbow)/2,left:l,right:r,confidence:Math.min(l.confidence,r.confidence)};
  }
  // Keep a usable side rather than alternating when the two confidence scores flicker.
  const previous=oldSide==='left'?l:oldSide==='right'?r:null;
  if(previous?.valid)return previous;
  if(l.valid&&r.valid)return l.score>=r.score?l:r;
  return l.valid?l:r.valid?r:{valid:false,reason:l.reason==='out-of-frame'||r.reason==='out-of-frame'?'out-of-frame':l.reason};
}

function posture(measurement,exercise){
  const m=measurement,p=m.image;
  if(exercise==='hang'){
    if(!m.left||!m.right||p.hip.y-p.shoulder.y<m.torso*.60||
       Math.abs(p.shoulder.x-p.hip.x)>m.torso*.7)return 'hang-position';
    for(const limb of [m.left,m.right]){
      if(limb.elbow<145||limb.image.wrist.y>limb.image.shoulder.y-m.torso*.4)return 'hang-position';
    }
    return null;
  }
  if(exercise==='boat'){
    // Side-on image heuristic: pelvis stays lowest, straight arms reach beyond
    // the shoulders and both extremities rise. Does not certify floor contact.
    const direction=Math.sign(p.shoulder.x-p.hip.x);
    if(!direction||Math.abs(p.shoulder.x-p.ankle.x)<m.torso*1.6||
       Math.abs(p.shoulder.y-p.hip.y)>m.torso*.65)return 'boat-position';
    if(m.elbow<140||m.knee<145||m.hip<135||
       (p.wrist.x-p.shoulder.x)*direction<m.torso*.35||
       (p.hip.x-p.ankle.x)*direction<m.torso*.65)return 'boat-position';
    if(p.hip.y-p.shoulder.y<m.torso*.04||
       p.hip.y-p.wrist.y<m.torso*.06||
       p.hip.y-p.ankle.y<m.torso*.06)return 'boat-position';
    return null;
  }
  if(exercise==='pushup'||exercise==='plank'){
    const bodySpan=distance(p.shoulder,p.ankle),tilt=Math.abs(p.shoulder.y-p.ankle.y)/bodySpan;
    if(bodySpan<0.24||tilt>0.48)return 'side-horizontal';
    if(m.line<(exercise==='plank'?160:152)||m.hip<(exercise==='plank'?157:148)||m.knee<(exercise==='plank'?158:150))return 'body-line';
    if(exercise==='pushup'){
      const shoulderHeight=supportHeight(p.shoulder,p.wrist,p.ankle),hipHeight=supportHeight(p.hip,p.wrist,p.ankle);
      if(!finite(shoulderHeight)||shoulderHeight<m.torso*0.12||hipHeight<m.torso*0.04)return 'hands-support';
    }else{
      const forearm=m.elbow>=65&&m.elbow<=115&&Math.abs(p.wrist.y-p.elbow.y)<=m.torso*0.25;
      const straight=m.elbow>=155;
      if(!forearm&&!straight)return 'plank-support';
      const support=forearm?p.elbow:p.wrist;
      const shoulderHeight=supportHeight(p.shoulder,support,p.ankle),hipHeight=supportHeight(p.hip,support,p.ankle);
      if(!finite(shoulderHeight)||shoulderHeight<m.torso*0.20||hipHeight<m.torso*0.08||Math.abs(support.x-p.shoulder.x)>m.torso*0.65)return 'plank-support';
    }
  }else if(exercise==='squat'){
    if(p.hip.y-p.shoulder.y<m.torso*0.52||Math.abs(p.shoulder.x-p.hip.x)>m.torso*0.80||p.ankle.y<=p.hip.y)return 'side-standing';
  }else{
    if(p.hip.y-p.shoulder.y<m.torso*0.65||Math.abs(p.shoulder.x-p.hip.x)>m.torso*0.65)return 'pullup-upright';
    if(Math.abs(m.left.elbow-m.right.elbow)>28)return 'arms-asymmetric';
    for(const side of [m.left,m.right])if(side.image.wrist.y>side.image.shoulder.y-m.torso*0.10)return 'raised-wrists';
  }
  return null;
}

const feedbackFor={
  'no-pose':'Встань так, чтобы камера видела тело целиком.',
  confidence:'Камера не уверена в положении тела. Добавь свет и открой обзор.',
  'out-of-frame':'Немного отойди: нужные суставы выходят за край кадра.',
  'body-size':'Поставь телефон так, чтобы тело целиком было крупнее в кадре.',
  geometry:'Положение суставов определяется неуверенно. Поправь ракурс.',
  'aspect-ratio':'Камера ещё не передала размер изображения.',
  'side-horizontal':'Поставь камеру сбоку: плечи, таз и стопы должны быть видны.',
  'body-line':'Счёт на паузе: камера не видит устойчивую линию тела.',
  'hands-support':'Камера должна видеть упор руками и стопы.',
  'hang-position':'Покажи обе руки над головой и спокойный вис. Не продолжай при боли или слабом хвате.',
  'boat-position':'Покажи лодочку строго сбоку: руки вперёд, кисти и стопы немного над ковриком. Не усиливай прогиб ради счётчика.',
  'plank-support':'Покажи камере упор на предплечьях или прямых руках.',
  'side-standing':'Встань боком к камере, чтобы были видны таз, колени и стопы.',
  'pullup-upright':'Камера должна видеть всё тело и обе руки на перекладине.',
  'arms-asymmetric':'Обе руки должны хорошо просматриваться.',
  'raised-wrists':'Нужны обе поднятые руки и неподвижная перекладина в кадре.',
  'camera-motion':'Кадр резко изменился. Поставь телефон устойчиво и начни заново.',
  'pose-spike':'Сустав резко сместился на одном кадре. Двигайся плавно и проверь ракурс.',
  'supports-moved':'Опорные точки сместились. Вернись в исходное положение.',
  'frame-gap':'Камера прервалась. Снова покажи исходное положение.',
  'timestamp':'Ожидаю новый кадр камеры.',
  'hidden':'Приложение скрыто — счёт на паузе.',
  'side-change':'Ракурс изменился. Снова покажи исходное положение.',
  'too-fast':'Повтор был слишком быстрым для уверенного подсчёта. Начни плавно.',
  'too-long':'Начни новый полный повтор из исходного положения.'
};

/**
 * @param {{exercise:'pushup'|'squat'|'plank'|'pullup'}} options
 * @returns {{update:Function,pause:Function,reset:Function}}
 */
export function createTracker({exercise}={}){
  if(!EXERCISES.has(exercise))throw new TypeError('Unknown exercise: '+exercise);
  // Small endpoint allowances for model-angle noise, scoped to these two moves.
  // Keep body travel, anchored supports, timing and a full return mandatory.
  // The intermediate band excludes the relaxed bottom, so that endpoint alone
  // cannot substitute for observed movement. Keep the existing return gate;
  // shifting it later loses sparse-camera returns between consecutive repeats.
  const angleLimits=exercise==='pushup'?{top:155,bottom:110,returnExit:119,midMin:112}
    :exercise==='squat'?{top:155,bottom:117,returnExit:119,midMin:117}
    :{top:LIMITS.topEnter,bottom:LIMITS.lowEnter,returnExit:LIMITS.lowExit,midMin:112};
  let count=0,holdMs=0,continuousHoldMs=0,lastTimestamp=null,lastFrameInterval=0,lastMeasurement=null,side=null,source=null;
  let boatDropoutAt=null;
  let stage='seek-start',dwell=null,reference=null,departureAt=null,returnAt=null,midOut=null,midBack=null,paused=false;
  let last={count:0,holdSeconds:0,phase:'setup',tracking:false,feedback:'Покажи исходное положение.',metrics:{exercise,reason:'no-pose'}};
  function clearCycle(){boatDropoutAt=null;stage='seek-start';dwell=null;reference=null;departureAt=null;returnAt=null;midOut=null;midBack=null;continuousHoldMs=0;}
  function clearContinuity(){clearCycle();lastMeasurement=null;side=null;source=null;}
  function publicPhase(){if(paused)return 'paused';if(exercise==='plank'||exercise==='boat'||exercise==='hang')return stage==='holding'?'holding':'setup';if(exercise==='pullup')return ({'seek-start':'setup',start:'hang',outbound:'lifting',extreme:'top',return:'lowering'})[stage];return ({'seek-start':'setup',start:'top',outbound:'lowering',extreme:'bottom',return:'rising'})[stage];}
  function snapshot(tracking,feedback,m=null,reason=null){
    const metrics={exercise,reason,side:m?.side||side,source:m?.source||source,confidence:rounded(m?.confidence),elbowAngle:rounded(m?.elbow),kneeAngle:rounded(m?.knee),hipAngle:rounded(m?.hip),bodyLineAngle:rounded(m?.line),continuousHoldSeconds:rounded(continuousHoldMs/1000),frameIntervalMs:rounded(lastFrameInterval),sampleHz:lastFrameInterval>0?rounded(1000/lastFrameInterval):null,repStage:stage,approximate:exercise==='pullup'};
    if(m?.left){metrics.leftElbowAngle=rounded(m.left.elbow);metrics.rightElbowAngle=rounded(m.right.elbow);}
    last={count,holdSeconds:rounded(holdMs/1000),phase:publicPhase(),tracking,feedback,metrics};return last;
  }
  function reject(reason,m=null){
    if(exercise==='boat'&&stage==='holding'&&['confidence','boat-position'].includes(reason)){
      boatDropoutAt??=lastTimestamp;
      if(lastTimestamp-boatDropoutAt<=600){
        lastMeasurement=null;
        return snapshot(false,'Небольшая пауза распознавания. Держись спокойно; эти секунды не добавляются.',m,reason);
      }
    }
    clearContinuity();return snapshot(false,feedbackFor[reason]||feedbackFor.geometry,m,reason);}
  function stable(key,timestamp,ms){if(dwell?.key!==key){dwell={key,since:timestamp,frames:1};return false;}dwell.frames++;return timestamp-dwell.since>=ms&&dwell.frames>=LIMITS.minDwellFrames;}
  function midSample(current,timestamp){return current?{...current,last:timestamp,frames:current.frames+1}:{first:timestamp,last:timestamp,frames:1};}
  // A 4–8 fps camera often sees only one intermediate frame in each direction.
  // Body travel, anchored supports, the full return and elapsed time are also
  // required; holding an extreme pose for several frames is not a repetition.
  const sufficientMid=x=>x&&x.frames>=1;
  const copyReference=m=>({startAngle:exercise==='squat'?m.knee:m.elbow,image:JSON.parse(JSON.stringify(m.image)),left:m.left?JSON.parse(JSON.stringify(m.left.image)):null,right:m.right?JSON.parse(JSON.stringify(m.right.image)):null,torso:m.torso,leg:m.leg});
  function supportOkay(m){if(!reference)return true;const r=reference,p=m.image;
    if(exercise==='squat')return distance(p.ankle,r.image.ankle)<=r.torso*0.30;
    if(exercise==='pushup')return distance(p.wrist,r.image.wrist)<=r.torso*0.30&&distance(p.ankle,r.image.ankle)<=r.torso*0.30;
    if(exercise==='pullup')return distance(m.left.image.wrist,r.left.wrist)<=r.torso*0.20&&distance(m.right.image.wrist,r.right.wrist)<=r.torso*0.20&&Math.abs(p.hip.x-r.image.hip.x)<=r.torso*0.50;
    return true;
  }
  function endReached(m){if(!reference)return false;const r=reference,p=m.image;
    if(exercise==='pushup')return m.elbow<=angleLimits.bottom&&p.shoulder.y-r.image.shoulder.y>=r.torso*0.18&&p.hip.y-r.image.hip.y>=r.torso*0.12;
    if(exercise==='squat')return m.knee<=angleLimits.bottom&&p.hip.y-r.image.hip.y>=r.leg*0.18;
    return m.left.elbow<=105&&m.right.elbow<=105&&r.image.shoulder.y-p.shoulder.y>=r.torso*0.22&&r.image.hip.y-p.hip.y>=r.torso*0.18;
  }
  function startReached(m){const angle=exercise==='squat'?m.knee:m.elbow;if(angle<angleLimits.top)return false;if(exercise==='pullup'&&(m.left.elbow<LIMITS.topEnter||m.right.elbow<LIMITS.topEnter))return false;
    if(exercise==='squat'&&m.hip<150)return false;
    if(reference&&stage!=='seek-start'){const tolerance=(exercise==='squat'?reference.leg:reference.torso)*0.15;if(Math.abs(m.image.hip.y-reference.image.hip.y)>tolerance)return false;}
    return true;
  }
  function update(input={}){
    paused=false;
    const t=input.timestamp;
    if(!finite(t)||t<0)return reject('timestamp');
    if(typeof document!=='undefined'&&document.hidden){lastTimestamp=t;return reject('hidden');}
    if(lastTimestamp!==null&&t<=lastTimestamp)return reject('timestamp');
    const delta=lastTimestamp===null?0:t-lastTimestamp;lastTimestamp=t;lastFrameInterval=delta;
    if(delta>LIMITS.maxFrameGap){clearContinuity();return snapshot(false,feedbackFor['frame-gap'],null,'frame-gap');}
    const m=bodyMeasurement(input,exercise,side);
    if(!m.valid)return reject(m.reason);
    if(side&&m.side!==side||source&&m.source!==source){clearContinuity();side=m.side;source=m.source;lastMeasurement=m;return snapshot(false,feedbackFor['side-change'],m,'side-change');}
    const posturalIssue=posture(m,exercise);if(posturalIssue)return reject(posturalIssue,m);
    if(lastMeasurement){
      const keys=selectedKeys(exercise);const maxStep=Math.max(...keys.map(k=>distance(m.image[k],lastMeasurement.image[k])));
      if(maxStep>Math.max(m.torso,lastMeasurement.torso)*LIMITS.maxJointStep)return reject('camera-motion',m);
      if(exercise!=='plank'&&exercise!=='boat'&&exercise!=='hang'){
        const before=exercise==='squat'?lastMeasurement.knee:lastMeasurement.elbow,now=exercise==='squat'?m.knee:m.elbow;
        // An isolated deep landmark glitch must not stand in for the turnaround.
        // Near a straight limb, angles are very sensitive to harmless jitter, so
        // use this speed guard only inside the bent part of the movement.
        if(before<150&&now<150&&Math.abs(now-before)>15+delta*.18)return reject('pose-spike',m);
      }
    }
    side=m.side;source=m.source;lastMeasurement=m;
    if(exercise==='boat'&&boatDropoutAt!==null){
      const elapsed=t-boatDropoutAt;boatDropoutAt=null;
      if(elapsed<=600)return snapshot(true,'Положение снова видно. Таймер продолжается.',m);
      clearCycle();
    }
    if(exercise==='plank'||exercise==='boat'||exercise==='hang'){
      if(stage!=='holding'){if(stable('plank',t,LIMITS.plankDwell)){stage='holding';dwell=null;}return snapshot(true,stage==='holding'?'Положение видно. Таймер идёт.':'Задержись: проверяю устойчивое положение.',m);}
      // Only intervals bounded by two valid, fresh, continuous frames are credited.
      // delta has already passed the freshness limit above. Use the real
      // interval, so an 8 fps camera does not turn 60 seconds into 75 seconds.
      holdMs+=delta;continuousHoldMs+=delta;
      return snapshot(true,'Положение видно. Таймер идёт.',m);
    }
    if(reference&&!supportOkay(m))return reject('supports-moved',m);
    if(departureAt!==null&&t-departureAt>LIMITS.maxRepMs)return reject('too-long',m);
    const a=exercise==='squat'?m.knee:m.elbow,atStart=startReached(m),atEnd=endReached(m),earlyTransit=a>angleLimits.midMin&&a<170,inMid=earlyTransit&&(exercise==='pullup'||reference&&a<=reference.startAngle-6);
    if(stage==='seek-start'){
      if(atStart&&stable('start',t,LIMITS.startDwell)){stage='start';reference=copyReference(m);dwell=null;}
      else if(!atStart)dwell=null;
      return snapshot(true,stage==='start'?(exercise==='pullup'?'Исходное положение видно. Можно подтягиваться.':'Исходное положение видно. Можно начинать.'):(exercise==='pullup'?'Покажи вис с выпрямленными руками.':'Покажи исходное положение и задержись.'),m);
    }
    if(stage==='start'){
      // Keep a visible early transit frame even if it has not yet crossed the
      // departure hysteresis threshold; slow cameras may see the deep pose next.
      // An endpoint may seed elapsed time, but only a visible angle change of
      // at least 6 degrees from the reference can be an intermediate sample.
      // Thus a relaxed top held still cannot masquerade as movement.
      const previousTransit=midOut;
      if(a>=170)midOut=null;
      else if(earlyTransit)midOut={...midSample(null,t),frames:inMid?1:0};
      if(a<LIMITS.topExit){
        stage='outbound';
        // Use only the immediately preceding fresh transit, not the first pose
        // from a long ready-position wait. A normal 1.5-second shallow-but-full
        // squat otherwise appeared "too fast" between the two hysteresis gates.
        departureAt=previousTransit&&t-previousTransit.last<=LIMITS.maxFrameGap?previousTransit.last:t;
        dwell=null;if(atEnd&&sufficientMid(midOut))stage='extreme';
      }
      return snapshot(true,exercise==='pullup'?'Поднимай тело к перекладине.':'Начни плавное движение вниз.',m);
    }
    if(stage==='outbound'){
      if(inMid)midOut=midSample(midOut,t);
      if(atStart){stage='start';reference=copyReference(m);dwell=null;departureAt=null;midOut=null;return snapshot(true,'Нужен полный повтор. Исходное положение принято.',m);}
      if(atEnd&&sufficientMid(midOut)){stage='extreme';dwell=null;}
      return snapshot(true,stage==='extreme'?(exercise==='pullup'?'Подъём замечен. Вернись в вис.':'Нижняя точка замечена. Вернись вверх.'):(exercise==='pullup'?'Продолжай подъём; руки держатся на месте.':'Продолжай движение; нужен полный диапазон.'),m);
    }
    if(stage==='extreme'){
      if(a>angleLimits.returnExit){stage='return';midBack=inMid?midSample(null,t):null;dwell=null;}
      return snapshot(true,exercise==='pullup'?'Плавно вернись в исходный вис.':'Вернись в исходное положение.',m);
    }
    if(stage==='return'){
      if(inMid)midBack=midSample(midBack,t);
      if(atEnd){stage='extreme';dwell=null;midBack=null;returnAt=null;return snapshot(true,'Вернись в исходное положение.',m);}
      if(atStart){
        if(returnAt===null)returnAt=t;
        const minMs=exercise==='pullup'?LIMITS.minPullupMs:LIMITS.minRepMs;
        if(returnAt-departureAt<minMs)return reject('too-fast',m);
        if(sufficientMid(midBack)){count++;stage='start';reference=copyReference(m);departureAt=null;returnAt=null;midOut=null;midBack=null;dwell=null;return snapshot(true,'Повтор засчитан.',m);}
      }else{dwell=null;returnAt=null;}
      return snapshot(true,'Заверши полный возврат в исходное положение.',m);
    }
    return snapshot(true,'Покажи исходное положение.',m);
  }
  function pause(){paused=true;lastTimestamp=null;lastFrameInterval=0;clearContinuity();return snapshot(false,'Пауза. Продолжим с исходного положения.',null,'paused');}
  function reset(){count=0;holdMs=0;continuousHoldMs=0;lastTimestamp=null;lastFrameInterval=0;paused=false;clearContinuity();return snapshot(false,'Покажи исходное положение.',null,'no-pose');}
  return Object.freeze({update,pause,reset});
}
