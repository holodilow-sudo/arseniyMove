import {validate,summary,exercises,duration,shift,dateKey,demoData} from './data.mjs';
const endpoint='https://raw.githubusercontent.com/holodilow-sudo/arseniy-move-stats/main/latest.json';
const $=id=>document.getElementById(id),blank=()=>({schema:1,timezone:'Asia/Chita',uploadedAt:null,days:[]});
let real=blank(),data=real,demo=false,period=7,metric='time',selected=dateKey(),month=selected.slice(0,7),loading=false,requestId=0;
const format=(day,options)=>new Date(day+'T12:00:00Z').toLocaleDateString('ru-RU',{timeZone:'UTC',...options});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notice(message,kind='info'){$('notice').textContent=message;$('notice').dataset.kind=kind;$('notice').hidden=!message;}
function render(){
 const p=summary(data,period),available=!!data.uploadedAt;
 $('active').textContent=available?`${p.active} из ${period}`:'—';$('duration').textContent=available?duration(p.seconds):'—';$('streak').textContent=available&&p.streak!==null?`${p.streak} дн.`:'—';
 $('duration-note').textContent=p.unknown?'Часть записей без длительности':'Включая паузы';$('period-label').textContent=`${format(p.rows[0].day,{day:'numeric',month:'short'})} — ${format(p.today,{day:'numeric',month:'short'})}`;
 $('streak-note').textContent=p.stale?'Нужны свежие данные':'По сохранённым подходам';
 $('synced').textContent=demo?'Пример · это не результаты Арсения':available?'Последняя отправка: '+new Date(data.uploadedAt).toLocaleString('ru-RU',{timeZone:data.timezone,day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})+' · '+data.timezone:'Данные с телефона ещё не поступили';
 $('synced').parentElement.dataset.ready=String(available&&!demo);$('demo').textContent=demo?'Вернуться к статистике':'Посмотреть пример';$('refresh').disabled=loading||demo;
 document.querySelectorAll('[data-period]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.period===period)));document.querySelectorAll('[data-metric]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.metric===metric)));
 const values=p.rows.map(r=>metric==='time'?r.seconds/60:r.sets),max=Math.max(3,...values),ceiling=Math.ceil(max/3)*3;
 $('chart-unit').textContent=metric==='time'?'Минут в день · включая паузы':'Сохранённых подходов в день';
 $('scale').innerHTML=[ceiling,ceiling*2/3,ceiling/3,0].map(n=>`<span>${Math.round(n)}</span>`).join('');
 $('bars').style.gridTemplateColumns=`repeat(${period},minmax(0,1fr))`;$('bars').dataset.dense=String(period===30);
 $('bars').innerHTML=p.rows.map((r,i)=>{const v=values[i],value=Math.round(v*10)/10;return `<button class="day" type="button" data-day="${r.day}" aria-pressed="${r.day===selected}" aria-label="${format(r.day,{day:'numeric',month:'long'})}: ${r.status==='unknown'?'нет данных':metric==='time'?duration(r.seconds)+(r.unknownDuration?', есть записи без времени':''):r.sets+' подходов'}"><span class="day-value">${r.status==='unknown'?'·':v?value:'—'}</span><span class="${v?'stick':r.status==='unknown'?'unknown':'zero'}" ${v?`style="height:${v/ceiling*156}px"`:''}></span></button>`}).join('');
 $('chart-start').textContent=format(p.rows[0].day,{day:'numeric',month:'short'});$('chart-end').textContent=format(p.today,{day:'numeric',month:'short'});
 const first=month+'-01',offset=(new Date(first+'T12:00:00Z').getUTCDay()+6)%7,last=new Date(+month.slice(0,4),+month.slice(5),0).getDate();
 $('month').textContent=format(first,{month:'long',year:'numeric'});$('next-month').disabled=month>=p.today.slice(0,7);
 $('calendar').innerHTML=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=>`<span class="weekday">${x}</span>`).join('')+'<span aria-hidden="true"></span>'.repeat(offset)+Array.from({length:last},(_,i)=>{const day=`${month}-${String(i+1).padStart(2,'0')}`,status=p.status(day),future=day>p.today;return `<button type="button" class="calday ${status==='active'?'done':''} ${day===p.today?'today':''}" data-day="${day}" aria-pressed="${selected===day}" ${future?'disabled':''} aria-label="${format(day,{day:'numeric',month:'long'})}: ${future?'будущий день':status==='active'?'есть тренировка':status==='empty'?'нет записи':'нет данных'}"><span>${i+1}</span><span class="day-mark" aria-hidden="true">${status==='active'?'✓':status==='empty'?'—':'·'}</span></button>`;}).join('');
 $('detail-title').textContent=format(selected,{day:'numeric',month:'long',weekday:'long'});const row=p.map.get(selected);
 $('detail').innerHTML=row?`<div class="detail-summary"><span>Подходов: ${row.sets}</span><span>·</span><span>${duration(row.seconds)}</span></div>${Object.entries(row.exercises).map(([id,n])=>`<div class="exercise"><span>${exercises[id][0]}</span><span class="count">${n} <small>${exercises[id][1]}</small></span></div>`).join('')}${row.unknownDuration?'<p class="detail-note">У части подходов длительность не записана. Они учтены в количестве занятий.</p>':''}`:`<p class="empty">${!available?'После подключения телефона здесь появятся результаты.':p.status(selected)==='unknown'?'За этот день данных пока нет. Это не означает пропуск тренировки.':'Сохранённых подходов за этот день нет. Это мог быть день отдыха.'}</p>`;
}
function ordinaryNotice(){if(demo)notice('Демонстрационный режим: все числа вымышлены. Настоящая статистика не изменяется.');else if(!real.uploadedAt)notice('Данные ещё не поступили. Страница готова, но отправка статистики из приложения пока не подключена. Можно посмотреть пример.');else if(summary(real).stale)notice('Данные давно не обновлялись. Дни после последней отправки не считаются пропусками.');else notice('');}
async function refresh(){if(loading||demo)return;loading=true;const id=++requestId;render();notice('Загружаем статистику…');const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const response=await fetch(endpoint,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok)throw Error(response.status===404?'Файл статистики ещё не опубликован.':`Не удалось получить данные (HTTP ${response.status}).`);const text=await response.text();if(text.length>600000)throw Error('Файл статистики слишком большой.');const next=validate(JSON.parse(text));if(id!==requestId)return;real=next;if(!demo)data=real;ordinaryNotice();}
 catch(e){if(id===requestId&&!demo)notice((e.name==='AbortError'?'GitHub не ответил. Попробуй обновить позже.':e instanceof SyntaxError?'Файл статистики повреждён.':e.message||'Не удалось загрузить данные.')+(real.uploadedAt?' Показаны ранее загруженные результаты.':''),'error');}
 finally{clearTimeout(timer);loading=false;render();}
}
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled)return;
 if(b.dataset.day){selected=b.dataset.day;month=selected.slice(0,7);render();}
 if(b.dataset.period){period=+b.dataset.period;render();}if(b.dataset.metric){metric=b.dataset.metric;render();}
});
$('refresh').addEventListener('click',refresh);$('demo').addEventListener('click',()=>{demo=!demo;data=demo?demoData():real;selected=dateKey(new Date(),data.timezone);month=selected.slice(0,7);ordinaryNotice();render();});
function moveMonth(n){const d=new Date(month+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);month=d.toISOString().slice(0,7);render();}
$('prev-month').addEventListener('click',()=>moveMonth(-1));$('next-month').addEventListener('click',()=>moveMonth(1));
render();refresh();setInterval(()=>{if(!document.hidden&&!demo)refresh();},300000);
