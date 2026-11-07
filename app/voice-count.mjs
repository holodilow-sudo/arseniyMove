const EXERCISES=new Set(['pushup','squat','plank','pullup','boat','hang']);
const TEST_PHRASE='Проверка голоса. Один, два, три.';
const COUNTER_LANGUAGE='ru-RU';

export function secondsPhrase(value){
  const seconds=Math.max(0,Math.floor(value));
  const lastTwo=seconds%100,last=seconds%10;
  const unit=lastTwo>=11&&lastTwo<=14?'секунд':last===1?'секунда':last>=2&&last<=4?'секунды':'секунд';
  return `${seconds} ${unit}`;
}

// Count events, not rendering frames, drive speech. The highest observed value
// advances even while muted or tracking is lost, so unmuting never replays it.
export function createVoiceCounter(options={}){
  const getNative=options.getNative||(()=>globalThis.MoveNative||globalThis.window?.MoveNative);
  const getSynthesis=options.getSynthesis||(()=>globalThis.speechSynthesis||globalThis.window?.speechSynthesis);
  const getUtterance=options.getUtterance||(()=>globalThis.SpeechSynthesisUtterance||globalThis.window?.SpeechSynthesisUtterance);
  let enabled=true,active=false,paused=false,exercise=null,lastValue=0,speechGeneration=0;
  let listener=options.onStatus||null;
  let status={state:'idle',available:false,message:'Русский голос ещё не проверен.',offline:false,language:COUNTER_LANGUAGE};
  const emit=next=>{status={...status,...next,language:COUNTER_LANGUAGE};listener?.({...status});return {...status};};
  const unavailable=message=>emit({state:'unavailable',available:false,offline:false,message});
  const native=()=>{const bridge=getNative();return typeof bridge?.speakCounter==='function'?bridge:null;};
  function cancelSpeech(){
    speechGeneration++;
    const bridge=native();
    try{if(bridge)bridge.stopCounterSpeech?.();else getSynthesis()?.cancel?.();}catch{/* Stopping speech must not interrupt a workout. */}
  }
  function browserVoice(){
    const synth=getSynthesis(),Utterance=getUtterance();
    if(!synth||typeof synth.speak!=='function'||typeof Utterance!=='function')return null;
    const voices=typeof synth.getVoices==='function'?synth.getVoices():[];
    const russian=voices.filter(voice=>/^ru(?:[-_]|$)/i.test(voice.lang||''));
    return {synth,Utterance,voice:russian.find(voice=>voice.localService===true)||null,pending:voices.length===0};
  }
  function browserReady(browser){
    if(!browser)return unavailable('Голосовой счёт недоступен в этом браузере.'),false;
    if(browser.pending)return emit({state:'initializing',available:false,offline:false,message:'Список голосов ещё загружается. Повтори проверку озвучки.'}),false;
    if(!browser.voice)return unavailable('Не найден локальный русский голос. Установи русский голос в настройках озвучки устройства.'),false;
    return true;
  }
  function prepare(){
    if(!enabled)return false;
    const bridge=native();
    if(bridge){
      try{
        if(typeof bridge.prepareCounterSpeech==='function')bridge.prepareCounterSpeech();
        return true;
      }catch{return unavailable('Не удалось подготовить русский голос телефона. Проверь настройки озвучки.'),false;}
    }
    try{
      const browser=browserVoice();
      if(!browserReady(browser))return false;
      emit({state:'ready',available:true,offline:true,message:'Локальный русский голос браузера готов.'});
      return true;
    }catch{return unavailable('Не удалось подготовить голос браузера.'),false;}
  }
  function speak(text){
    if(!enabled)return false;
    const bridge=native();
    if(bridge){
      try{
        // Android uses QUEUE_FLUSH and replaces any pending initialization phrase.
        bridge.speakCounter(text);
        return true;
      }catch{return unavailable('Не удалось озвучить счёт. Проверь русский голос в настройках телефона.'),false;}
    }
    try{
      const browser=browserVoice();
      if(!browserReady(browser))return false;
      cancelSpeech();
      const generation=speechGeneration,utterance=new browser.Utterance(text);
      utterance.lang=COUNTER_LANGUAGE;utterance.rate=1;utterance.pitch=1;utterance.volume=1;
      if(browser.voice)utterance.voice=browser.voice;
      utterance.onstart=()=>{if(generation===speechGeneration&&enabled)emit({state:'ready',available:true,offline:browser.voice?.localService===true,message:'Русский голос браузера готов.'});};
      utterance.onerror=event=>{
        if(generation!==speechGeneration||!enabled||['canceled','interrupted'].includes(event?.error))return;
        unavailable('Не удалось произнести счёт. Проверь громкость и русский голос устройства.');
      };
      browser.synth.speak(utterance);
      return true;
    }catch{return unavailable('Не удалось запустить голосовой счёт в браузере.'),false;}
  }
  function begin(id,value){
    cancelSpeech();exercise=EXERCISES.has(id)?id:null;active=!!exercise;paused=false;
    lastValue=Number.isFinite(value)&&value>=0?Math.floor(value):0;
    if(active&&enabled)prepare();
  }
  const controller={
    configure(value){const wasEnabled=enabled;enabled=value===true;if(!enabled)cancelSpeech();else if(!wasEnabled&&active&&!paused)prepare();return enabled;},
    start(id,initialValue=0){begin(id,initialValue);},
    update(value,tracking=true){
      if(!active||!Number.isFinite(value)||value<0)return false;
      const next=Math.floor(value),previous=lastValue;
      if(next<=previous)return false;
      lastValue=next;
      if(!enabled||paused||tracking!==true)return false;
      if(['plank','boat','hang'].includes(exercise)){
        const boundary=Math.floor(next/10)*10;
        if(boundary===0||Math.floor(previous/10)>=Math.floor(next/10))return false;
        return speak(secondsPhrase(boundary));
      }
      return speak(String(next));
    },
    pause(){paused=true;cancelSpeech();},
    resume(id,currentValue=0){begin(id,currentValue);},
    stop(){active=false;paused=false;exercise=null;lastValue=0;cancelSpeech();},
    test(){if(!enabled)return false;cancelSpeech();return prepare()&&speak(TEST_PHRASE);},
    acceptStatus(value){
      let next=value;
      if(typeof next==='string'){try{next=JSON.parse(next);}catch{return false;}}
      if(!next||!['idle','initializing','ready','unavailable'].includes(next.state))return false;
      emit({state:next.state,available:next.available===true,message:typeof next.message==='string'?next.message:'',offline:next.offline===true});
      return true;
    },
    setOnStatus(callback){listener=typeof callback==='function'?callback:null;listener?.({...status});},
    get status(){return {...status};},
    get enabled(){return enabled;}
  };
  return controller;
}

export const voiceCounter=createVoiceCounter();
