import {dayKey, EXERCISES, validSessionResult} from './state.mjs';

// Calendar arithmetic uses the phone's local dates, including DST transitions.
function dateAt(key) { const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d,12); }
function shift(key,amount) { const d=dateAt(key);d.setDate(d.getDate()+amount);return dayKey(d); }
function duration(session) {
  if(Number.isFinite(session.durationSeconds)&&session.durationSeconds>=0)return session.durationSeconds;
  const elapsed=(Date.parse(session.endedAt)-Date.parse(session.startedAt))/1000;
  return Number.isFinite(elapsed)&&elapsed>=0?elapsed:null;
}
export function trainingProgress(history,{now=new Date(),days=7}={}) {
  days=days===30?30:7;
  const today=dayKey(now),byDay=new Map(),ids=new Set();
  for(const h of history) {
    if(!validSessionResult(h)||ids.has(h.id)||Date.parse(h.endedAt)>new Date(now).getTime())continue;
    ids.add(h.id);
    const key=dayKey(h.endedAt);
    if(!byDay.has(key))byDay.set(key,{key,sets:0,seconds:0,unknownDuration:0,exercises:{}});
    const row=byDay.get(key),seconds=duration(h);
    row.sets++;
    if(seconds===null)row.unknownDuration++;else row.seconds+=seconds;
    row.exercises[h.exercise]=(row.exercises[h.exercise]||0)+h.actual;
  }
  const keys=[...byDay.keys()].sort(),firstDay=keys[0]||null;
  let bestStreak=0,run=0,previous=null;
  for(const key of keys){run=previous&&shift(previous,1)===key?run+1:1;bestStreak=Math.max(bestStreak,run);previous=key;}
  // An unfinished today does not break yesterday's series.
  let currentStreak=0,cursor=byDay.has(today)?today:shift(today,-1);
  while(byDay.has(cursor)){currentStreak++;cursor=shift(cursor,-1);}
  const rows=Array.from({length:days},(_,i)=>{
    const key=shift(today,i-days+1),row=byDay.get(key)||{key,sets:0,seconds:0,unknownDuration:0,exercises:{}};
    return {...row,status:row.sets?'active':key===today?'today':firstDay&&key>=firstDay?'missed':'before'};
  });
  return {today,firstDay,rows,currentStreak,bestStreak,totalDays:keys.length,
    activeDays:rows.filter(r=>r.sets>0).length,missedDays:rows.filter(r=>r.status==='missed').length,
    sets:rows.reduce((sum,r)=>sum+r.sets,0),seconds:rows.reduce((sum,r)=>sum+r.seconds,0),
    unknownDuration:rows.reduce((sum,r)=>sum+r.unknownDuration,0)};
}
export function formatTime(seconds) {
  const n=Math.floor(seconds);
  if(n<60)return `${n} с`;
  return `${Math.floor(n/60)} мин${n%60?` ${n%60} с`:''}`;
}
const shortDate=key=>dateAt(key).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
const fullDate=key=>dateAt(key).toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'});
const statuses={active:'Есть тренировка',missed:'Нет записи',today:'Сегодня ещё можно позаниматься',before:'До первой тренировки'};

export function renderTrainingProgress(history,{days=7,metric='sets',selected=null,now=new Date()}={}) {
  const p=trainingProgress(history,{days,now}),time=metric==='time';
  const selectedDay=p.rows.find(r=>r.key===selected)||p.rows.at(-1);
  const values=p.rows.map(r=>time?r.seconds/60:r.sets),maximum=Math.max(1,...values);
  const ceiling=time?Math.ceil(maximum*10)/10:Math.ceil(maximum);
  const first=p.rows[0],offset=(dateAt(first.key).getDay()+6)%7;
  return `<section class="training-progress" aria-label="Регулярность тренировок">
    <div class="progress-period" role="group" aria-label="Период графика">${[7,30].map(n=>`<button class="chip ${p.rows.length===n?'active':''}" data-action="progress-period" data-days="${n}" aria-pressed="${p.rows.length===n}">${n} дней</button>`).join('')}</div>
    <div class="progress-streak"><div><span class="eyebrow">ТВОЯ СЕРИЯ СЕЙЧАС</span><strong>${p.currentStreak}<small> дн. подряд</small></strong></div><span class="progress-best">Лучшая серия<br><b>${p.bestStreak} дн.</b></span></div>
    <p class="progress-caption">${p.currentStreak?'Продолжай в своём темпе. Отдых тоже важен.':p.firstDay?'Каждый новый подход — возможность начать серию.':'Сохрани первый подход — здесь начнётся твоя история.'}</p>
    <div class="progress-totals"><div><strong>${p.activeDays}<small> / ${p.rows.length}</small></strong><span>дней с тренировкой</span></div><div><strong>${p.sets}</strong><span>сохранённых подходов</span></div></div>
    <section class="panel progress-chart-panel"><span class="eyebrow">${shortDate(first.key)} — ${shortDate(p.today)}</span><h2>Тренировки по дням</h2>
      <div class="progress-metrics" role="group" aria-label="Показатель графика">${[['sets','Подходы'],['time','Время']].map(([id,title])=>`<button class="chip ${metric===id?'active':''}" data-action="progress-metric" data-metric="${id}" aria-pressed="${metric===id}">${title}</button>`).join('')}</div>
      <div class="progress-axis"><span>${time?'Минуты':'Подходы'}</span><span>Верх шкалы: ${ceiling.toLocaleString('ru-RU')}</span></div>
      <div class="progress-bars" role="img" aria-label="График по дням. За период: ${p.sets} подходов, время ${formatTime(p.seconds)}${p.unknownDuration?', часть времени неизвестна':''}. Значения доступны в календаре ниже.">
        ${p.rows.map((r,i)=>`<div class="progress-column ${r.key===selectedDay.key?'selected':''}" title="${fullDate(r.key)}: ${r.sets} подходов, ${formatTime(r.seconds)}"><span class="progress-bar ${r.status}" style="height:${values[i]>0?Math.max(2,values[i]/ceiling*100):0}%"></span></div>`).join('')}
      </div><div class="progress-axis"><span>0 · ${shortDate(first.key)}</span><span>${shortDate(p.today)}</span></div>
      <p class="progress-caption">Время подходов за период: <b>${formatTime(p.seconds)}</b>${p.unknownDuration?' · есть записи без длительности':''}.</p>
      <p class="progress-help">Время — от начала до сохранения, включая паузы. Это не чистое время движения. У записей без длительности время неизвестно.</p>
    </section>
    <section class="panel progress-calendar-panel"><h2>Календарь занятий</h2><p class="progress-caption">Выбери день, чтобы увидеть результат.</p>
      <div class="progress-weekdays" aria-hidden="true">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d=>`<span>${d}</span>`).join('')}</div>
      <div class="progress-calendar">${'<span aria-hidden="true"></span>'.repeat(offset)}${p.rows.map(r=>`<button class="progress-day ${r.status} ${r.key===p.today?'is-today':''} ${r.key===selectedDay.key?'selected':''}" data-action="progress-day" data-day="${r.key}" aria-pressed="${r.key===selectedDay.key}" aria-label="${fullDate(r.key)}. ${statuses[r.status]}. Подходов: ${r.sets}"><span>${dateAt(r.key).getDate()}</span><small>${r.status==='active'?'✓':r.status==='missed'?'−':r.status==='today'?'·':''}</small></button>`).join('')}</div>
      <div class="progress-legend"><span>✓ Есть тренировка</span><span>− Нет записи</span><span>Обводка — сегодня</span></div>
      <div class="progress-day-detail" aria-live="polite"><span class="eyebrow">${fullDate(selectedDay.key)}</span>${selectedDay.sets?`<strong>Подходов: ${selectedDay.sets} · ${selectedDay.unknownDuration?'известное время: ':''}${formatTime(selectedDay.seconds)}</strong>${selectedDay.unknownDuration?'<p class="progress-help">У части подходов длительность не записана.</p>':''}<ul>${Object.entries(selectedDay.exercises).map(([id,n])=>`<li><span>${EXERCISES[id].name}</span><b>${Math.floor(n)} ${['plank','boat','hang'].includes(id)?'с':'раз'}</b></li>`).join('')}</ul>`:`<strong>${statuses[selectedDay.status]}</strong><p class="progress-help">${selectedDay.status==='missed'?'Сохранённых подходов нет. Это мог быть день отдыха.':selectedDay.status==='today'?'День ещё идёт — пропуска пока нет.':'Дни до первой записи не считаются пропусками.'}</p>`}</div>
      <p class="progress-help">За период дней без записи: ${p.missedDays}. Считаем только завершившиеся дни после первой тренировки. День с любым сохранённым непустым подходом продолжает серию; время — местное на телефоне.</p>
    </section>
  </section>`;
}
