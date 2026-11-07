export const EXERCISES = {
  pushup: {name:'Отжимания', short:'Сила рук', goal:10, unit:'повторов', icon:'pushup', color:'lime', placement:'Поставь телефон сбоку на устойчивую опору. В кадре должны быть плечи, кисти, таз и стопы.', cue:'Начни с упора на прямых руках. Считается полный цикл вниз и обратно вверх.'},
  squat: {name:'Приседания', short:'Сильные ноги', goal:20, unit:'повторов', icon:'squat', color:'orange', placement:'Поставь телефон сбоку, чтобы целиком были видны плечи, таз, колени и стопы.', cue:'Начни стоя. Счётчик добавит повтор после приседания и возвращения в исходное положение.'},
  plank: {name:'Планка', short:'Твой баланс', goal:60, unit:'секунд', icon:'plank', color:'blue', placement:'Телефон сбоку. В кадре должны быть плечи, локти, таз и стопы.', cue:'Планка на предплечьях. Время идёт, пока камера видит устойчивое положение. Можно остановиться и отдохнуть.'},
  pullup: {name:'Подтягивания', short:'Личный прогресс', goal:1, unit:'повторов', icon:'pullup', color:'purple', placement:'Телефон перед тобой под небольшим углом. В кадре должны помещаться перекладина и всё тело, включая руки, колени и стопы.', cue:'Начни с выпрямленными руками. Камера оценивает полный цикл подъёма и опускания, но не проверяет, выше ли подбородок перекладины.'},
  boat: {name:'Лодочка', short:'Удержание на животе', goal:30, unit:'секунд', icon:'boat', color:'blue', placement:'Поставь телефон строго сбоку на уровне коврика, без наклона. Всё тело, кисти и стопы должны помещаться в кадре.', cue:'Лёжа на животе, вытягивай руки вперёд. Достаточно небольшого подъёма рук, груди и ног. Допускается небольшой сгиб рук и коленей. Не тянись выше ради счётчика; без рывка и сильного прогиба. Не запрокидывай голову. Камера приблизительно оценивает удержание; если больно — остановись.'},
  hang: {name:'Вис на турнике', short:'Твой хват', goal:30, unit:'секунд', icon:'pullup', color:'purple', placement:'Телефон перед тобой под небольшим углом. Покажи обе руки, перекладину и всё тело, включая стопы.', cue:'Держись за перекладину двумя руками, без раскачивания. Допускается небольшой сгиб локтей. Время выбираете с папой. Камера оценивает положение, но не проверяет хват и отрыв стоп от пола. Если больно или хват ослабевает — закончи подход.'}
};
export const PHRASES = ['Сегодня чуть увереннее, чем вчера.', 'Твой темп. Твой прогресс.', 'Не спеши. Полный повтор важнее скорости.', 'Отдых — тоже часть тренировки.', 'Один честный шаг уже меняет день.'];
export function defaultState() {
  return {version:1, plan:Object.fromEntries(Object.entries(EXERCISES).map(([id,x])=>[id,x.goal])), sound:true, voiceCount:true, muted:false,
    reminder:{enabled:false,time:'07:00',days:[1,2,3,4,5,6,7],status:'off'}, history:[], coins:0, xp:0, theme:'lime', owned:['lime']};
}
export function dayKey(value=new Date()) { const d=new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
export function validSessionResult(session) {
  if(!session||!Object.hasOwn(EXERCISES,session.exercise)||typeof session.id!=='string'||!session.id||session.source!=='camera-estimate'||!Number.isFinite(session.actual)||!Number.isFinite(session.trackedFrames)||session.trackedFrames<3||!Number.isFinite(Date.parse(session.endedAt)))return false;
  if(session.mode==='free')return session.goal===null&&session.actual>=1&&(['plank','boat','hang'].includes(session.exercise)||Number.isInteger(session.actual));
  // Existing goal-based records remain valid only after their original goal was reached.
  return Number.isFinite(session.goal)&&session.goal>=1&&session.actual>=session.goal;
}
export function loadState(storage,key) {
  const d=defaultState();
  try { const s=JSON.parse(storage.getItem(key)); if(!s||s.version!==1)return d;
    for(const id of Object.keys(EXERCISES)) { const n=Number(s.plan?.[id]); if(Number.isInteger(n)&&n>=1&&n<=(['plank','boat','hang'].includes(id)?180:50))d.plan[id]=n; }
    d.sound=s.sound!==false; d.voiceCount=s.voiceCount!==false; d.muted=s.muted===true;
    const ids=new Set();
    d.history=Array.isArray(s.history)?s.history.filter(h=>{if(!validSessionResult(h)||ids.has(h.id)||(!key.includes('preview')&&h.demo))return false;ids.add(h.id);return true;}):[];
    // Rewards are reconstructed from the ledger, never from an editable total.
    const rewarded=new Set();
    for(const h of d.history) { const k=`${dayKey(h.endedAt)}:${h.exercise}`; h.rewarded=!rewarded.has(k); rewarded.add(k); }
    d.coins=d.history.filter(h=>h.rewarded).length*20; d.xp=d.history.filter(h=>h.rewarded).length*50;
    d.owned=['lime',...new Set(Array.isArray(s.owned)?s.owned.filter(v=>['orange','blue'].includes(v)):[])];
    d.coins=Math.max(0,d.coins-(d.owned.length-1)*80); d.theme=d.owned.includes(s.theme)?s.theme:'lime';
    if(s.reminder&&typeof s.reminder==='object')d.reminder={...d.reminder,...s.reminder,days:Array.isArray(s.reminder.days)?s.reminder.days.filter(n=>Number.isInteger(n)&&n>=1&&n<=7):[]};
    return d;
  }catch{return d;}
}
export function completeSession(state, session) {
  if(session&&state.history.some(x=>x.id===session.id)) return {added:false,coins:0,xp:0};
  if(!validSessionResult(session))throw new Error('Нет подтверждённого камерой результата для сохранения');
  const rewarded=!state.history.some(h=>h.exercise===session.exercise&&dayKey(h.endedAt)===dayKey(session.endedAt));
  state.history.push({...session,rewarded}); if(rewarded){state.coins+=20;state.xp+=50;}
  return {added:true,coins:rewarded?20:0,xp:rewarded?50:0};
}
export function todayCompleted(state){return new Set(state.history.filter(h=>dayKey(h.endedAt)===dayKey()).map(h=>h.exercise));}
export function chooseRequestExercise(state){const done=todayCompleted(state);return Object.keys(EXERCISES).find(id=>!done.has(id))||null;}
