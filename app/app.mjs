import {updatePanel} from './updates.mjs';
import {TUTORIALS} from './tutorials.mjs';
import {EXERCISES,PHRASES,loadState,completeSession,todayCompleted,chooseRequestExercise,dayKey} from './state.mjs';
import {renderTrainingProgress} from './progress.mjs';
import {createTracker} from './pose-engine.mjs';
import {VisionCamera} from './camera.mjs';
import {cameraPermissions} from './camera-permission.mjs';
import {sound} from './sounds.mjs';
import {voiceCounter} from './voice-count.mjs';
import {createReport,saveReport,shareReport} from './report.mjs';

let updateStatus={};
try{updateStatus=JSON.parse(window.MoveNative?.getUpdateStatus?.()||'{}');}catch{}
let progressDays=7,progressMetric='sets',progressDay=null;
const params=new URLSearchParams(location.search);
const DEMO=['localhost','127.0.0.1'].includes(location.hostname)&&params.get('preview')==='1';
const STORE=DEMO?'arseniy-move-preview-v1':'arseniy-move-v1';
let cameraFacing='user',lastCameraIssue=null,resumeAfterStop=false,voiceStatus={state:'idle',message:''};
try{cameraFacing=localStorage.getItem(`${STORE}-camera-facing`)==='environment'?'environment':'user';lastCameraIssue=JSON.parse(localStorage.getItem(`${STORE}-camera-issue`)||'null');}catch{}
let state=loadState(localStorage,STORE),screen='home',exercise='pushup',session=null,tracker=null,lastResult=null,reportCanvas=null,requestMinutes=null,requestExercise='pushup',demoTimer=null,cameraPaused=false,savingFailed=false,shareBusy=false,toastTimer,preparationOrigin='home',tutorialReturn='home';
const app=document.querySelector('#app'),dialog=document.querySelector('#dialog');
const camera=new VisionCamera();
syncAudio();
voiceCounter.setOnStatus(status=>{voiceStatus=status;refreshVoiceStatus();});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
function save(){try{localStorage.setItem(STORE,JSON.stringify(state));savingFailed=false;return true;}catch{savingFailed=true;toast('Не удалось сохранить прогресс. Освободи место на устройстве.');return false;}}
function toast(message){const t=document.querySelector('#toast');t.textContent=message;t.classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add('hidden'),4800);}
function audioEnabled(){return !state.muted&&(state.sound||state.voiceCount);}
function syncAudio(){sound.set(state.sound&&!state.muted);voiceCounter.configure(state.voiceCount&&!state.muted);}
function voiceHint(){if(state.muted)return 'Звук выключен кнопкой сверху.';if(!state.voiceCount)return 'Голосовой счёт выключен.';if(voiceStatus.state==='unavailable')return voiceStatus.message||'Русский голос недоступен. Открой настройки голоса телефона.';if(voiceStatus.state==='initializing')return 'Готовим русский голос…';if(voiceStatus.state==='ready')return 'Голос готов. Громкость меняется кнопками телефона.';return 'Русский голос телефона. Перед тренировкой можно проверить озвучку.';}
function refreshVoiceStatus(){const status=document.querySelector('#voice-status');if(status)status.textContent=voiceHint();const hint=document.querySelector('#voice-workout-status');if(hint){const failed=state.voiceCount&&!state.muted&&voiceStatus.state==='unavailable';hint.classList.toggle('hidden',!failed);hint.textContent=failed?voiceHint():'';}}
function refreshAudioButton(){const b=document.querySelector('[data-action="sound"]');if(!b)return;const enabled=audioEnabled();b.setAttribute('aria-pressed',String(enabled));b.setAttribute('aria-label',enabled?'Выключить все звуки':'Включить звук');b.innerHTML=icon('sound')+(enabled?'':'<b class="sound-off">/</b>');refreshVoiceStatus();}
function icon(name){
  const paths={pushup:'M6 18h6l7-10 16 4 6 6h5M19 8l-1 10h6M35 12l-3 6h7',squat:'M20 7l4 10-12 5 8 12h10M24 17l12 3 7-5M24 17l9 9-3 8',plank:'M6 23h9l8-9 17 5 5 4h4M23 14l-1 9h8',pullup:'M6 6h42M15 6l1 13 10 5 10-5 1-13M26 24v10l-8 10M26 34l8 10',home:'M7 21L26 5l19 16v23H32V29H20v15H7Z',reward:'M17 5h18v16c0 13-18 13-18 0ZM17 10H8v5c0 8 9 10 9 10M35 10h9v5c0 8-9 10-9 10M26 31v11M16 44h20',settings:'M8 14h36M8 26h36M8 38h36M18 9v10M35 21v10M23 33v10',camera:'M6 15h11l4-6h12l4 6h9v30H6ZM35 29a9 9 0 1 1-18 0a9 9 0 1 1 18 0',share:'M26 34V6M17 15l9-9 9 9M10 28v16h32V28',arrow:'M10 26h32M30 14l12 12-12 12',back:'M37 26H10M22 14L10 26l12 12',sound:'M8 21h9L29 11v30L17 31H8ZM36 18q10 8 0 16M42 12q15 14 0 28',check:'M10 27l11 11L43 14',clock:'M26 12v15l10 6M46 26a20 20 0 1 1-40 0a20 20 0 1 1 40 0',star:'m26 5 6 14 15 2-11 10 3 16-13-8-13 8 3-16L5 21l15-2Z'};
  return `<svg viewBox="0 0 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name]||paths.star}"/>${['pushup','plank'].includes(name)?'<circle cx="16" cy="6" r="3" fill="currentColor" stroke="none"/>':name==='squat'?'<circle cx="19" cy="3" r="3" fill="currentColor" stroke="none"/>':name==='pullup'?'<circle cx="26" cy="16" r="4"/>':''}</svg>`;
}
function button(label,action,cls='primary',extra=''){return `<button class="button ${cls}" data-action="${action}" ${extra}>${label}</button>`;}
function cameraChoice(){return `<div class="camera-choice" role="group" aria-label="Выбрать камеру">${[['user','Передняя'],['environment','Задняя']].map(([id,label])=>`<button class="chip ${cameraFacing===id?'active':''}" data-action="camera-facing" data-facing="${id}" aria-pressed="${cameraFacing===id}">${label} камера</button>`).join('')}</div>`;}
function cameraDiagnostic(detail,c=nativeCapabilities()||{}){return [`Arseniy Move ${c.appVersion||'1.0.14'}`,`${detail.stage||'camera'} / ${detail.code||'UNKNOWN'}`,detail.reason?String(detail.reason).slice(0,300):'',c.model?`${c.manufacturer||''} ${c.model}`:'',c.androidVersion?`Android ${c.androidVersion}`:'',c.webViewVersion?`WebView ${c.webViewVersion}`:'',`Камера: ${cameraFacing==='user'?'передняя':'задняя'}`,`Доступ: ${c.available?(c.cameraPermission?'разрешён':'не разрешён'):'браузер'}`].filter(Boolean).join('\n');}
function rememberCameraIssue(message,detail){lastCameraIssue={message,diagnostic:cameraDiagnostic(detail)};try{localStorage.setItem(`${STORE}-camera-issue`,JSON.stringify(lastCameraIssue));}catch{}}
function nav(){return `<nav class="bottom-nav" aria-label="Разделы">${[['home','home','Тренировка'],['progress','reward','Прогресс'],['settings','settings','Настройки']].map(([id,i,title])=>`<button class="nav-button ${screen===id?'active':''}" data-action="nav" data-screen="${id}" ${screen===id?'aria-current="page"':''}>${icon(i)}<span>${title}</span></button>`).join('')}</nav>`;}
function header(back=false){return `<header class="topbar">${back?`<button class="icon-button" data-action="back" aria-label="Назад">${icon('back')}</button>`:`<div class="brand"><span class="brand-mark">M<span>↗</span></span><div>ARSENIY<span>MOVE / ТВОЙ РИТМ</span></div></div>`}<div class="header-balance"><span class="coin-dot">◆</span> ${state.coins}</div><button class="icon-button" data-action="sound" aria-label="${audioEnabled()?'Выключить все звуки':'Включить звук'}" aria-pressed="${audioEnabled()}">${icon('sound')}${audioEnabled()?'':'<b class="sound-off">/</b>'}</button></header>`;}
// Keep preview media in the top-level document: nested video surfaces can render black in the desktop browser.
function tutorialPreviewPicker(){
  if(!DEMO||params.get('tutorialGallery')!=='1')return '';
  return `<aside class="tutorial-preview-picker"><strong>ПРЕДПРОСМОТР · APK НЕ СОБРАН</strong><label for="preview-exercise">Выбери упражнение</label><select id="preview-exercise">${Object.entries(EXERCISES).map(([id,x])=>`<option value="${id}" ${exercise===id?'selected':''}>${escape(x.name)} · ${TUTORIALS[id].seconds} сек</option>`).join('')}</select><a href="media/${exercise}-technique.mp4" target="_blank" rel="noopener">Открыть ролик отдельно ↗</a></aside>`;
}
function render(){
  document.documentElement.dataset.accent=state.theme;
  const content={home:home,tutorial:tutorial,setup:setup,workout:workout,result:result,progress:progress,settings:settings,request:request,report:report}[screen]||home;
  app.innerHTML=`${tutorialPreviewPicker()}${DEMO?'<div class="demo-banner">ПРЕДПРОСМОТР · все результаты здесь демонстрационные</div>':''}${header(!['home','progress','settings'].includes(screen))}<main id="main" class="screen" tabindex="-1">${['home','progress'].includes(screen)?'<div id="update-banner"></div>':''}${content()}${screen==='settings'?'<div id="update-settings"></div>':''}</main>${['home','progress','settings'].includes(screen)?nav():''}`;
  if(screen==='report')drawReportPreview();refreshVoiceStatus();refreshUpdates();
  window.MoveNative?.setUpdateAllowed?.(['home','settings','progress'].includes(screen));
}
function refreshUpdates(){
  if(!window.MoveNative?.getUpdateStatus)return;
  const banner=document.querySelector('#update-banner'),settings=document.querySelector('#update-settings');
  if(banner)banner.innerHTML=updatePanel(updateStatus,false);
  if(settings)settings.innerHTML=updatePanel(updateStatus,true);
}
function home(){
  const done=todayCompleted(state);
  return `<section class="hero"><div class="hero-copy"><span class="tag">ЛИЧНАЯ ТРЕНИРОВКА</span><h1>Твой ход,<br><em>Арсений.</em></h1><p>Двигайся в своём ритме.<br>Камера поможет считать.</p><span class="hero-day">${done.size?'Сегодня есть результат':'Начни в своём темпе'}</span></div><div class="hero-figure" aria-hidden="true"></div></section>
  <div class="section-head"><div><span class="eyebrow">ВЫБЕРИ ДВИЖЕНИЕ</span><h2>Шесть шагов к силе</h2></div><span class="pill">ТВОЙ ТЕМП</span></div>
  <div class="workout-grid">${Object.entries(EXERCISES).map(([id,x],i)=>`<button class="exercise-card ${x.color} ${done.has(id)?'done':''}" data-action="exercise" data-exercise="${id}"><span class="exercise-top"><span class="exercise-art exercise-art-${id}" aria-hidden="true"></span><span class="exercise-number">${done.has(id)?'✓':`0${i+1}`}</span></span><strong class="exercise-title">${x.name}</strong><span class="exercise-goal free-label"><strong aria-hidden="true">∞</strong> <small>${['plank','boat','hang'].includes(id)?'Секундомер':'Свободный счёт'}</small></span><span class="exercise-footer">${done.has(id)?'Есть результат сегодня':x.short}<span>↗</span></span></button>`).join('')}</div>
  <button class="internet-card" data-action="request"><span class="request-symbol">↗</span><span><strong>Папа, можно интернет?</strong><small>Задание → результат → просьба папе</small></span><span>→</span></button>
  <div class="motivation"><span>✦</span><p>${PHRASES[new Date().getDate()%PHRASES.length]}</p></div>
  <p class="footnote">${state.reminder.enabled?`Напоминание: ${'07:00 и 19:00 каждый день · сб и вс ещё 14:00'} · ${escape(reminderStatus())}`:'Напоминания пока выключены. Время можно выбрать в настройках.'}</p>`;
}
function tutorial(){const t=TUTORIALS[exercise],x=EXERCISES[exercise];return `<section class="tutorial-heading"><span class="eyebrow">${escape(x.name.toUpperCase())} · ВИДЕО ${t.seconds} СЕК</span><h1>Сначала техника</h1><p>Посмотри движение. Русские подписи помогут разобраться.</p></section>
  <div class="tutorial-player"><video id="tutorial-video" controls playsinline preload="metadata" poster="media/${exercise}-poster.jpg" style="aspect-ratio:${t.burned? '16/11':'16/9'}" aria-label="${escape(x.name)}: видео с русскими подсказками"><source src="media/${exercise}-technique.mp4" type="video/mp4"><track kind="subtitles" src="media/${exercise}-technique-ru.vtt" srclang="ru" label="Русские подсказки" ${t.burned?'':'default'}>На этом устройстве видео не поддерживается. Используй подсказки ниже.</video></div>
  <section class="panel tutorial-tips" aria-label="${escape(x.name)}: три подсказки"><ol>${t.tips.map((tip,i)=>`<li><span>0${i+1}</span><strong>${escape(tip)}</strong></li>`).join('')}</ol></section>
  ${button(`${icon('camera')} К настройке камеры`,'tutorial-next')}
  <p class="footnote tutorial-note">Камера включится на следующем экране — только по твоему нажатию.</p>
  <details class="tutorial-source"><summary>О видео</summary><p>Видео: ${escape(t.title)} · ${escape(t.author)}. ${escape(t.excerpt)}. ${t.burned?'Без звука. Русские подсказки встроены в видео.':'Звук — английский. Русские подсказки можно включить в плеере.'} Материал отмечен источником как общественное достояние.</p><p>Источник: ${t.sourceId?`DVIDS · видео ${t.sourceId}`:'CDC · Muscle Strengthening at Home'}. Использование материала не означает одобрение приложения его автором.</p>${t.sourceId?'<p lang="en">The appearance of U.S. Department of War (DoW) visual information does not imply or constitute DoW endorsement.</p>':''}</details>`;}
function setup(){const x=EXERCISES[exercise];return `<div class="section-head"><div><span class="eyebrow">${requestMinutes?'ЗАДАНИЕ ДЛЯ ПРОСЬБЫ ПАПЕ':'ГОТОВИМСЯ К ДВИЖЕНИЮ'}</span><h1>${x.name}</h1></div></div>
  <div class="setup-art ${x.color}"><span class="exercise-art exercise-art-${exercise}" aria-hidden="true"></span><div><strong aria-hidden="true">∞</strong><span>${['plank','boat','hang'].includes(exercise)?'Секундомер':'Свободный счёт'}</span></div></div>
  <p class="free-count-note">Сколько делать — договоритесь с папой. Камера считает, а ты сам нажимаешь «Завершить».</p>
  <section class="panel"><h2>Настроим камеру</h2><ol class="setup-list"><li>${x.placement}</li><li>Убедись, что свет падает на тебя, а телефон не двигается.</li><li>${x.cue}</li></ol></section>
  <div class="camera-note">${icon('camera')}<p>Подсчёт на устройстве.<br><strong>Видео не сохраняется.</strong></p></div>
  ${DEMO?'':cameraChoice()}${button(DEMO?'Посмотреть демонстрацию':'Включить камеру','start')}
  ${button('Повторить технику','tutorial-repeat','ghost')}
  <p class="footnote">${DEMO?'В предпросмотре счётчик анимирован для показа интерфейса. Камера не включается.':['plank','boat','hang'].includes(exercise)?'Прими устойчивое положение и дождись надписи «Таймер идёт». Если больно или тяжело — остановись.':'Перед первым повтором задержись в исходном положении, пока появится «Готов». Затем двигайся плавно. Если больно или тяжело — остановись.'}</p>`;}
function workout(){const x=EXERCISES[exercise];return `<div class="section-head"><div><span class="eyebrow">${DEMO?'ДЕМОНСТРАЦИЯ ЭКРАНА':'КАМЕРА · ПОДСЧЁТ ДВИЖЕНИЙ'}</span><h1>${x.name}</h1></div><span class="pill" id="tracking-state">${DEMO?'ДЕМО':'Подготовка'}</span></div>
  <div class="camera-stage ${cameraFacing==='environment'?'rear-camera':''}"><video id="camera-video" playsinline autoplay muted></video><canvas id="pose-overlay"></canvas><div class="camera-placeholder ${DEMO?'demo-pose':''}" id="camera-placeholder"><span class="exercise-art exercise-art-${exercise}" aria-hidden="true"></span><span>${DEMO?'ПРИМЕР ДВИЖЕНИЯ':'Камера готовится'}</span></div><div class="frame-corners"></div><div class="camera-top"><span class="camera-dot"></span>${DEMO?'ДЕМО · БЕЗ КАМЕРЫ':'ЛОКАЛЬНО · БЕЗ ЗАПИСИ'}</div><div class="camera-feedback" id="camera-feedback" role="status">${DEMO?'Полное движение → один повтор':'Подготавливаем распознавание…'}</div></div>
  <div class="counter free-counter"><span class="counter-value" id="count-value">${Math.floor(session?.actual||0)}</span><span class="counter-unit"><small>${x.unit}</small></span></div><p class="free-count-note workout-free-note">Счёт без цели. Закончи подход, когда решишь.</p><p class="footnote hidden" id="voice-workout-status" role="status"></p>
  <div class="row workout-controls">${button('Пауза','pause','secondary','id="pause-button"')}${button('Завершить','stop','ghost')}</div><section class="panel hidden camera-error" id="camera-error" role="alert"><h2>Проверим подключение</h2><p id="camera-error-message"></p>${button('Попробовать другую камеру','switch-camera','secondary')}${window.MoveNative?.openAppSettings?button('Разрешения приложения','app-settings','ghost'):''}<details><summary>Данные для проверки</summary><pre id="camera-error-code"></pre><p class="footnote">Если снова не подключится, покажи папе этот экран. Видео сюда не сохраняется.</p></details></section><p class="footnote" id="tracking-note">${['plank','boat','hang'].includes(exercise)?'Время идёт только при видимом устойчивом положении.':'Повтор засчитывается после полного движения туда и обратно.'}</p>${DEMO?'':`<details class="panel tracking-check" id="tracking-check"><summary>Проверка счётчика</summary><p id="tracking-check-hint">Ожидаю первые движения.</p><pre id="tracking-check-data"></pre><p class="footnote">Если счёт стоит на месте, сделай скриншот этого блока. Здесь только измерения — видео не записывается.</p></details>`}`;}
function result(){const r=lastResult;if(!r)return home();return `<div class="result-hero"><span class="eyebrow">${DEMO?'ПРИМЕР ЗАВЕРШЕНИЯ':'ЕЩЁ ОДИН ШАГ ВПЕРЁД'}</span><div class="medal">${icon('reward')}<span>✓</span></div><h1>Есть результат!</h1><p>${EXERCISES[r.exercise].name} · ${Math.floor(r.actual)} ${['plank','boat','hang'].includes(r.exercise)?'секунд':'повторов'}</p><div class="confetti" aria-hidden="true">${Array.from({length:12},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</div></div>
  <div class="stat-grid"><div class="stat"><span>ОПЫТ</span><strong class="reward-number">+${r.reward?.xp||0}</strong><small>к твоему прогрессу</small></div><div class="stat"><span>МОНЕТЫ</span><strong class="reward-coins">+${r.reward?.coins||0} <small>◆</small></strong><small>на цвета профиля</small></div></div>
  <div class="motivation"><span>✦</span><p>${r.reward?.coins?'Сегодня ты стал на шаг увереннее.':'Награда за это упражнение сегодня уже получена. Отдых тоже важен.'}</p></div>
  <section class="panel dad-panel"><span class="eyebrow">ПАПА БУДЕТ РАД УЗНАТЬ</span><h2>Не забудь поделиться<br>результатом с папой</h2><p>Отправь красивую карточку через MAX или другой мессенджер.</p>${button(`${icon('share')} ${requestMinutes?`Попросить ${requestMinutes} мин интернета`:'Подготовить отчёт'}`,'report')}</section>
  ${savingFailed?'<p class="error">Результат пока не сохранён. Попробуй освободить место на устройстве.</p>':''}${button('К тренировкам','home','ghost')}`;}
function progress(){const done=state.history.length,pullups=Math.max(0,...state.history.filter(x=>x.exercise==='pullup').map(x=>x.actual)),days=new Set(state.history.map(x=>dayKey(x.endedAt))).size;
  const badges=[['Первый шаг',done>=1,'Первый сохранённый подход'],['Все четыре',['pushup','squat','plank','pullup'].every(id=>state.history.some(h=>h.exercise===id)),'Попробовать все упражнения'],['Своя привычка',days>=3,'Позаниматься в 3 разных дня'],['Выше планки',pullups>=2,'Засчитать 2 подтягивания за подход']];
  return `<span class="eyebrow">КАЖДЫЙ ШАГ СЧИТАЕТСЯ</span><h1>Твой прогресс</h1>${renderTrainingProgress(state.history,{days:progressDays,metric:progressMetric,selected:progressDay})}<div class="stat-grid"><div class="stat"><span>ПОДХОДОВ</span><strong>${done}</strong></div><div class="stat"><span>ЛИЧНЫЙ РЕЙТИНГ</span><strong>${state.xp}</strong><small>очки за тренировки</small></div></div><section class="pullup-progress panel"><span class="eyebrow">ПОДТЯГИВАНИЯ</span><h2>${pullups} — твой лучший результат</h2><p>Тренируйся в своём темпе. Сколько делать — решайте вместе с папой.</p></section>
  <div class="section-head"><h2>Твои значки</h2><span class="pill">${badges.filter(x=>x[1]).length} / 4</span></div><div class="badge-grid">${badges.map(([title,owned,hint])=>`<div class="badge ${owned?'':'locked'}">${icon('reward')}<strong>${title}</strong><small>${hint}</small></div>`).join('')}</div>
  <div class="section-head"><h2>Свой цвет</h2><span class="pill">${state.coins} ◆</span></div><div class="chip-row">${[['lime','Лайм'],['orange','Закат'],['blue','Лёд']].map(([id,name])=>`<button class="chip color-chip ${id} ${state.theme===id?'active':''}" data-action="theme" data-theme="${id}">${name}<small>${state.owned.includes(id)?'Открыт':'80 ◆'}</small></button>`).join('')}</div>
  <div class="section-head"><h2>История тренировок</h2></div>${state.history.length?state.history.slice(-15).reverse().map(h=>`<button class="history-item" data-action="history" data-id="${escape(h.id)}"><span class="exercise-art exercise-art-${h.exercise}" aria-hidden="true"></span><span><strong>${EXERCISES[h.exercise].name}</strong><small>${new Date(h.endedAt).toLocaleDateString('ru-RU')} · ${DEMO?'демо':'подсчёт камерой'}</small></span><b>${Math.floor(h.actual)} ${['plank','boat','hang'].includes(h.exercise)?'с':'раз'}</b></button>`).join(''):'<div class="panel"><p>Здесь появится первое выполненное задание.</p></div>'}`;
}
function nativeCapabilities(){try{return JSON.parse(window.MoveNative?.getCapabilities?.()||'null');}catch{return null;}}
function reminderStatus(){if(state.reminder.status==='current')return state.reminder.active?'включено':!state.reminder.enabled?'выключено':!state.reminder.notificationPermission?'нужно разрешение уведомлений':'проверь настройки уведомлений';const map={scheduled:'может прийти с задержкой',permission_required:'нужно разрешение уведомлений',permission_requested:'ожидаем разрешение уведомлений',notifications_blocked:'уведомления выключены в Android',disabled:'выключено',off:'выключено',browser:'включается в Android-приложении'};return map[state.reminder.status]||'проверь настройки Android';}
function permissionsPanel(){const c=nativeCapabilities();if(!c?.available)return '';return `<section class="panel"><h2>Разрешения Android</h2><p>Камера: <strong>${c.cameraPermission?'разрешена':'нужен доступ'}</strong><br>Уведомления: <strong>${c.reminder?.notificationsAvailable?'разрешены':'выключены'}</strong></p>${!c.cameraPermission?button('Разрешить камеру','camera-permission','secondary'):''}${button('Открыть настройки Android','app-settings','ghost')}<p class="footnote">Разрешение камеры не включает съёмку. Камера запускается только по кнопке в тренировке.</p></section>`;}
function settings(){const days=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];return `<span class="eyebrow">ПОДСТРОЙ ПОД СЕБЯ</span><h1>Твой ритм</h1><section class="panel"><h2>Свободный счёт</h2><p>Во всех упражнениях камера считает повторы или секунды. Обязательной нормы и автоматической остановки нет — нажми «Завершить», когда закончил.</p><p>Количество вы с папой выбираете сами. Отчёт сохраняет фактический результат, которым можно поделиться.</p></section>
  <form id="reminder-form" class="panel"><h2>Напомнить о тренировке</h2><p>По времени телефона. Можно выключить все напоминания одним переключателем.</p><label class="row switch"><span>Напоминания</span><input type="checkbox" name="enabled" ${state.reminder.enabled?'checked':''}></label><div class="reminder-times"><div><strong>07:00</strong><span>Каждое утро</span></div><div><strong>19:00</strong><span>Каждый вечер</span></div><div><strong>14:00</strong><span>Дополнительно в субботу и воскресенье</span></div></div>${button('Сохранить напоминание','save-reminder','secondary','type="submit"')}<p class="footnote">${escape(reminderStatus())}. Android может задерживать уведомление при экономии батареи.</p></form>
  <section class="panel"><h2>Считай на слух</h2><label class="row switch"><span>Голосовой счёт</span><input id="voice-switch" type="checkbox" ${state.voiceCount?'checked':''}></label><p>Каждый засчитанный повтор — вслух по-русски. В планке, лодочке и висе — время каждые 10 секунд.</p>${button('Проверить голос','test-voice','secondary')}<p class="footnote" id="voice-status" role="status">${escape(voiceHint())}</p>${window.MoveNative?.openSpeechSettings?button('Настройки голоса телефона','voice-settings','ghost'):''}</section>
  <section class="panel"><label class="row switch"><span>Звуки кнопок и наград</span><input id="sound-switch" type="checkbox" ${state.sound?'checked':''}></label>${button('Послушать награду','test-sound','ghost')}<p class="footnote">Кнопка динамика сверху выключает голос и звуковые эффекты. При паузе или сворачивании счёт замолкает.</p></section>
  ${permissionsPanel()}${lastCameraIssue?`<section class="panel camera-error"><h2>Последняя проверка камеры</h2><p>${escape(lastCameraIssue.message)}</p><details><summary>Данные для проверки</summary><pre>${escape(lastCameraIssue.diagnostic)}</pre></details></section>`:''}<section class="panel"><h2>Камера и честный подсчёт</h2><p>Обработка на устройстве. Видео не записывается и никуда не отправляется. В истории остаются числа, время и тип упражнения.</p><p>Подсчёт приблизительный. Камера не подтверждает личность и не заменяет проверку техники взрослым.</p><p class="footnote">Arseniy Move · 1.0.14 · MediaPipe Pose Landmarker</p></section>`;}
function request(){const existing=state.history.filter(h=>dayKey(h.endedAt)===dayKey()).at(-1);requestExercise=chooseRequestExercise(state)||'pushup';const x=EXERCISES[requestExercise];return `<span class="eyebrow">ТВОЯ ПРОСЬБА ПАПЕ</span><h1>Сделал дело.<br><em>Поделись.</em></h1><div class="request-hero"><span>↗</span><p>Папа, можно немного<br>времени в интернете?</p></div><section class="panel"><h2>Сколько минут попросить?</h2><div class="chip-row">${[15,30,45].map(n=>`<button class="chip ${n===(requestMinutes||15)?'active':''}" data-action="minutes" data-minutes="${n}">${n} мин</button>`).join('')}</div><p class="footnote">Это просьба. Интернет разрешает папа.</p></section>
  ${existing?`<section class="panel"><span class="tag">УЖЕ ЕСТЬ РЕЗУЛЬТАТ</span><h2>${EXERCISES[existing.exercise].name}: ${Math.floor(existing.actual)}</h2><p>Сегодня уже есть сохранённый подход. Можно поделиться этим результатом.</p>${button('Подготовить просьбу папе','use-today')}</section>`:`<section class="panel"><span class="tag">ПОДХОД В СВОЁМ ТЕМПЕ</span><h2>${x.name}</h2><p>Сколько делать — договоритесь с папой. Камера посчитает, а после «Завершить» ты сможешь отправить результат и просьбу.</p>${button('Начать задание','start-request')}</section>`}
  <div class="motivation"><span>✦</span><p>Результат отправляешь ты.<br>Решение принимает папа.</p></div>`;}
function report(){return `<span class="eyebrow">${requestMinutes?'РЕЗУЛЬТАТ + ПРОСЬБА':'ГОТОВО ПОДЕЛИТЬСЯ'}</span><h1>Папа, смотри!</h1><p class="share-intro">Картинка с результатом готова. Отправь её папе прямо из приложения.</p><div id="report-container" class="report-preview"></div>${button(`${icon('share')} Отправить папе`,'share')}<div class="share-route"><span class="messenger-badge">MAX</span><span>Выбери мессенджер → чат с папой → отправь картинку</span></div>${window.AndroidShare?.shareImage?'':button('Сохранить картинку','download','secondary')}<p class="footnote">Подойдёт MAX или другой мессенджер, который установлен на телефоне.${DEMO?' На компьютере вместо выбора мессенджера может скачаться PNG.':''}</p>`;}
function drawReportPreview(){if(!lastResult)return;reportCanvas=createReport(lastResult,{demo:DEMO,minutes:requestMinutes});reportCanvas.setAttribute('role','img');reportCanvas.setAttribute('aria-label',`Отчёт: ${EXERCISES[lastResult.exercise].name}, ${Math.floor(lastResult.actual)} ${['plank','boat','hang'].includes(lastResult.exercise)?'секунд':'повторов'}${DEMO?', демонстрационные данные':''}`);document.querySelector('#report-container').append(reportCanvas);}
function pauseTutorial(){document.querySelector('#tutorial-video')?.pause();}
function go(next){pauseTutorial();voiceCounter.stop();if(screen==='workout'){stopCamera();}screen=next;render();window.scrollTo(0,0);document.querySelector('#main')?.focus({preventScroll:true});}
function stopCamera(){voiceCounter.pause();camera.stop();clearInterval(demoTimer);demoTimer=null;tracker?.pause();}
async function startWorkout(){
  session={id:uid(),exercise,mode:'free',goal:null,actual:0,startedAt:new Date().toISOString(),trackedFrames:0,lostFrames:0,source:'camera-estimate',algorithmVersion:3,demo:DEMO};
  tracker=createTracker({exercise});cameraPaused=false;screen='workout';render();window.scrollTo(0,0);
  if(DEMO){startDemoCounter();return;}
  await beginCamera();
}
async function beginCamera(){
  voiceCounter.resume(exercise,session?.actual||0);
  const current=session?.id,diagnosticsCaps=nativeCapabilities()||{};let gapFrames=0,previousFrameTime=null,frameIntervals=[];
  document.querySelector('#camera-error')?.classList.add('hidden');
  await camera.start({video:document.querySelector('#camera-video'),canvas:document.querySelector('#pose-overlay'),facing:cameraFacing,
    onStatus:message=>{if(session?.id!==current||screen!=='workout')return;document.querySelector('#camera-feedback').textContent=message;},
    onPreview:({facing}={})=>{if(session?.id===current&&screen==='workout'){document.querySelector('#camera-placeholder').classList.add('hidden');document.querySelector('.camera-stage').classList.toggle('rear-camera',facing==='environment');}},
    onError:(message,detail={})=>{if(screen!=='workout'||session?.id!==current)return;rememberCameraIssue(message,detail);tracker?.pause();voiceCounter.pause();cameraPaused=true;document.querySelector('#pause-button').textContent='Продолжить';document.querySelector('#camera-feedback').textContent='Подсчёт остановлен — подсказка ниже';document.querySelector('#tracking-state').textContent='Пауза';document.querySelector('#camera-placeholder').classList.remove('hidden');document.querySelector('#camera-placeholder>span:last-child').textContent='Камера остановлена';document.querySelector('#camera-error').classList.remove('hidden');document.querySelector('#camera-error-message').textContent=message;document.querySelector('#camera-error-code').textContent=lastCameraIssue.diagnostic;document.querySelector('#camera-error').scrollIntoView({block:'nearest'});},
    onResult:frame=>{
      if(screen!=='workout'||cameraPaused||session?.id!==current)return;
      document.querySelector('#camera-placeholder').classList.add('hidden');
      const r=tracker.update(frame);if(r.tracking)session.trackedFrames++;else session.lostFrames++;
      gapFrames=r.metrics?.reason==='frame-gap'?gapFrames+1:Math.max(0,gapFrames-1);
      const feedback=frame.multiplePeople?'В кадре должен быть один человек':gapFrames>=3?'Обработка кадров слишком медленная. Поставь на паузу, закрой другие приложения и попробуй снова.':r.feedback;
      if(previousFrameTime!==null&&frame.timestamp>previousFrameTime){frameIntervals.push(frame.timestamp-previousFrameTime);if(frameIntervals.length>12)frameIntervals.shift();}previousFrameTime=frame.timestamp;
      const fps=frameIntervals.length?1000/(frameIntervals.reduce((a,b)=>a+b,0)/frameIntervals.length):null;
      const value=['plank','boat','hang'].includes(exercise)?r.holdSeconds:r.count;updateCounter(value,r.tracking,feedback,r.phase);
      updateTrackingCheck(r,frame,fps,feedback,diagnosticsCaps);
    }
  });
}
function updateTrackingCheck(result,frame,fps,feedback,caps){
  const m=result.metrics||{},num=x=>Number.isFinite(x)?Math.round(x):'—';
  const text=[cameraDiagnostic({stage:'tracking',code:m.reason||m.repStage||'waiting'},caps),`Упражнение: ${EXERCISES[exercise].name}`,`Кадров/с: ${fps?fps.toFixed(1):'—'}`,`Обработка кадра: ${num(frame.inferenceMs)} мс`,`Уверенность: ${Number.isFinite(m.confidence)?num(m.confidence*100)+'%':'—'}`,`Локоть: ${num(m.elbowAngle)}° · колено: ${num(m.kneeAngle)}°`,`Линия тела: ${num(m.bodyLineAngle)}°`,`Счёт: ${['plank','boat','hang'].includes(exercise)?result.holdSeconds:result.count}`].join('\n');
  const hint=document.querySelector('#tracking-check-hint'),data=document.querySelector('#tracking-check-data');if(hint)hint.textContent=feedback;if(data)data.textContent=text;
}
function updateCounter(value,tracking,feedback,phase){
  if(!session||screen!=='workout')return;const old=Math.floor(session.actual);session.actual=value;
  document.querySelector('#count-value').textContent=Math.floor(value);
  if(!DEMO)voiceCounter.update(value,tracking);
  const label={setup:'Подготовка',top:exercise==='pullup'?'Вниз':'Готов',hang:'Готов',lowering:'Вниз',bottom:'Обратно вверх',rising:'Вверх',lifting:'Вверх',holding:'Таймер идёт'}[phase]||'В кадре';
  document.querySelector('#camera-feedback').textContent=feedback;document.querySelector('#tracking-state').textContent=DEMO?'ДЕМО':tracking?label:'Пауза подсчёта';
  if(Math.floor(value)>old&&(!['plank','boat','hang'].includes(exercise)||Math.floor(value/10)>Math.floor(old/10))){if(!state.voiceCount||voiceStatus.state==='unavailable')sound.count();const el=document.querySelector('#count-value');el.classList.remove('pop');void el.offsetWidth;el.classList.add('pop');}
}
function startDemoCounter(){clearInterval(demoTimer);demoTimer=setInterval(()=>{if(screen!=='workout'||cameraPaused)return;session.trackedFrames+=10;updateCounter(session.actual+(['plank','boat','hang'].includes(exercise)?5:1),true,['plank','boat','hang'].includes(exercise)?'Демо: время удержания':'Демо: полный цикл засчитан');},850);}
function finishWorkout(){if(!session||session.actual<1)return;stopCamera();session.endedAt=new Date().toISOString();session.durationSeconds=Math.round((Date.parse(session.endedAt)-Date.parse(session.startedAt))/1000);const reward=completeSession(state,session);lastResult={...session,reward};save();sound.reward();go('result');session=null;}
function pauseWorkout(){if(screen!=='workout')return;cameraPaused=!cameraPaused;const paused=cameraPaused;
  if(paused){stopCamera();document.querySelector('#camera-feedback').textContent='Отдыхай. Подсчёт остановлен.';document.querySelector('#tracking-state').textContent='Пауза';}
  else {if(DEMO)startDemoCounter();else beginCamera();}
  document.querySelector('#pause-button').textContent=paused?'Продолжить':'Пауза';
}
function showDialog(html){document.querySelector('#dialog-body').innerHTML=html;dialog.showModal();}
function stopDialog(){resumeAfterStop=!cameraPaused;if(resumeAfterStop)pauseWorkout();const hasResult=session?.actual>=1;showDialog(`<h2>${hasResult?'Сохранить результат?':'Закончить подход?'}</h2><p>${hasResult?`Камера посчитала: ${Math.floor(session.actual)} ${['plank','boat','hang'].includes(exercise)?'секунд':'повторов'}. Сохрани результат и поделись им с папой.`:'Пока нет засчитанных повторов или секунд. Можно продолжить или выйти без сохранения.'}</p>${hasResult?button('Сохранить и завершить','save-finish','primary'):''}${button('Продолжить подход','cancel-stop','secondary')}${button(hasResult?'Выйти без сохранения':'Выйти','confirm-stop','ghost')}`);}
function cancelStop(){dialog.close();const resume=resumeAfterStop;resumeAfterStop=false;if(resume&&screen==='workout'&&cameraPaused)pauseWorkout();}
dialog.addEventListener('cancel',event=>{event.preventDefault();cancelStop();});
async function handleAction(action,el){
  if(action!=='sound'&&action!=='test-sound')sound.tap();
  switch(action){
    case 'progress-period':progressDays=Number(el.dataset.days)===30?30:7;progressDay=null;render();break;
    case 'progress-metric':progressMetric=el.dataset.metric==='time'?'time':'sets';render();break;
    case 'progress-day':progressDay=el.dataset.day;render();break;
    case 'nav':requestMinutes=null;go(el.dataset.screen);break;
    case 'home':requestMinutes=null;go('home');break;
    case 'exercise':requestMinutes=null;exercise=el.dataset.exercise;preparationOrigin='home';tutorialReturn='home';go('tutorial');break;
    case 'back':if(screen==='workout')stopDialog();else if(screen==='report')go('result');else if(screen==='tutorial')go(tutorialReturn);else if(screen==='setup'){tutorialReturn=preparationOrigin;go('tutorial');}else{requestMinutes=null;go('home');}break;
    case 'tutorial-next':go('setup');break;
    case 'tutorial-repeat':tutorialReturn='setup';go('tutorial');break;
    case 'start':startWorkout();break;
    case 'camera-facing':cameraFacing=el.dataset.facing==='environment'?'environment':'user';try{localStorage.setItem(`${STORE}-camera-facing`,cameraFacing);}catch{}render();break;
    case 'switch-camera':if(screen!=='workout')break;stopCamera();cameraFacing=cameraFacing==='user'?'environment':'user';try{localStorage.setItem(`${STORE}-camera-facing`,cameraFacing);}catch{}cameraPaused=false;render();await beginCamera();break;
    case 'pause':pauseWorkout();break;
    case 'stop':stopDialog();break;
    case 'cancel-stop':cancelStop();break;
    case 'save-finish':dialog.close();resumeAfterStop=false;finishWorkout();break;
    case 'confirm-stop':dialog.close();resumeAfterStop=false;stopCamera();session=null;requestMinutes=null;go('home');break;
    case 'sound':if(audioEnabled())state.muted=true;else {state.muted=false;if(!state.sound&&!state.voiceCount){state.sound=true;state.voiceCount=true;}}syncAudio();save();refreshAudioButton();if(state.sound&&!state.muted)sound.tap();break;
    case 'check-update':window.MoveNative?.checkForUpdates?.();break;
    case 'install-update':if(['home','settings','progress'].includes(screen))window.MoveNative?.installUpdate?.();break;
    case 'app-settings':window.MoveNative?.openAppSettings?.();break;
    case 'camera-permission':try{await cameraPermissions.ensure();refreshNative();toast('Доступ к камере разрешён');}catch(error){if(error.name!=='AbortError')toast(error.message);}break;
    case 'test-voice':if(!state.voiceCount||state.muted){toast('Включи голосовой счёт и звук кнопкой сверху.');break;}voiceCounter.test();break;
    case 'voice-settings':voiceCounter.stop();window.MoveNative?.openSpeechSettings?.();break;
    case 'test-sound':if(!state.sound||state.muted){toast('Сначала включи звуки');break;}sound.reward();break;
    case 'request':requestMinutes=15;go('request');break;
    case 'minutes':requestMinutes=Number(el.dataset.minutes);render();break;
    case 'start-request':requestMinutes||=15;exercise=requestExercise;preparationOrigin='request';tutorialReturn='request';go('tutorial');break;
    case 'use-today':lastResult={...state.history.filter(h=>dayKey(h.endedAt)===dayKey()).at(-1),reward:{coins:0,xp:0}};go('report');break;
    case 'report':go('report');break;
    case 'history':requestMinutes=null;lastResult={...state.history.find(x=>x.id===el.dataset.id),reward:{coins:0,xp:0}};go('report');break;
    case 'download':try{await saveReport(reportCanvas);toast('Картинка подготовлена для сохранения');}catch{toast('Не удалось сохранить картинку');}break;
    case 'share':{
      if(shareBusy)return;shareBusy=true;el.disabled=true;
      try{const status=await shareReport(reportCanvas,`share-${Date.now()}`);if(status==='native')toast('Открываем выбор приложения…');if(status==='saved')toast('Картинка подготовлена для сохранения. Прикрепи её к сообщению папе.');}
      catch(error){if(error.name!=='AbortError')toast('Не удалось открыть отправку. Сохрани картинку отдельно.');}
      finally{shareBusy=false;el.disabled=false;}break;
    }
    case 'theme':{
      const theme=el.dataset.theme;if(!state.owned.includes(theme)){if(state.coins<80){toast('Цвет стоит 80 монет. Зарабатывай их за тренировки.');break;}state.coins-=80;state.owned.push(theme);sound.reward();}state.theme=theme;save();render();break;
    }
  }
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b||b.disabled||b.dataset.action==='save-reminder')return;handleAction(b.dataset.action,b);});
document.addEventListener('change',e=>{if(e.target.id==='sound-switch'){state.sound=e.target.checked;syncAudio();save();refreshAudioButton();if(state.sound&&!state.muted)sound.tap();}if(e.target.id==='voice-switch'){state.voiceCount=e.target.checked;syncAudio();save();refreshAudioButton();}});
document.addEventListener('change',e=>{
  if(!DEMO||params.get('tutorialGallery')!=='1'||e.target.id!=='preview-exercise'||!EXERCISES[e.target.value])return;
  pauseTutorial();stopCamera();exercise=e.target.value;requestMinutes=null;preparationOrigin='home';tutorialReturn='home';
  params.set('exercise',exercise);params.set('screen','tutorial');history.replaceState(null,'',`${location.pathname}?${params}`);go('tutorial');
});
document.addEventListener('submit',e=>{
  if(e.target.id==='reminder-form'){e.preventDefault();const f=new FormData(e.target),days=[1,2,3,4,5,6,7],enabled=f.get('enabled')==='on',time='07:00';if(enabled&&!days.length){toast('Выбери хотя бы один день');return;}if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)){toast('Укажи время');return;}
    const reminder={enabled,time,days,requestId:uid()};
    if(window.MoveNative?.scheduleReminder){state.reminder={...reminder,status:'pending'};save();try{MoveNative.scheduleReminder(JSON.stringify(reminder));toast('Проверяем настройки уведомлений…');}catch{state.reminder.status='error';save();toast('Не удалось сохранить напоминание');}}
    else {state.reminder={...reminder,enabled:false,status:'browser'};save();toast('Напоминания включаются в установленной Android-версии');render();}
  }
});
function pauseForBackground(){pauseTutorial();voiceCounter.pause();if(screen==='workout'&&!cameraPaused){cameraPaused=true;stopCamera();const b=document.querySelector('#pause-button');if(b)b.textContent='Продолжить';document.querySelector('#camera-feedback').textContent='Камера выключена. Нажми «Продолжить».';document.querySelector('#tracking-state').textContent='Пауза';}sound.stop();}
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!nativeCapabilities()?.permissionPromptActive)pauseForBackground();});window.addEventListener('pagehide',()=>{pauseForBackground();camera.stop();});
function applyNativeReminder(result){state.reminder={...state.reminder,...result};if(result.status==='disabled')state.reminder.enabled=false;save();}
function refreshNative(){try{updateStatus=JSON.parse(window.MoveNative?.getUpdateStatus?.()||'{}');}catch{}refreshUpdates();window.MoveNative?.setUpdateAllowed?.(['home','settings','progress'].includes(screen));const c=nativeCapabilities();if(c?.available&&c.reminder){applyNativeReminder(c.reminder);if(['settings','home'].includes(screen))render();}}
window.addEventListener('focus',refreshNative);
window.MoveApp={pauseForBackground,
  nativeUpdateStatus(status){if(status&&typeof status==='object'){updateStatus=status;refreshUpdates();}},
  nativeSpeechStatus(status){voiceCounter.acceptStatus(status);},
  nativeCameraPermissionResult(result){cameraPermissions.receive(result);},
  nativePermissionsChanged(){refreshNative();},
  nativeReminderResult(result){try{if(typeof result==='string')result=JSON.parse(result);if(result.requestId&&state.reminder.requestId&&result.requestId!==state.reminder.requestId)return;applyNativeReminder(result);toast(result.message||({scheduled:'Напоминание сохранено',permission_required:'Разреши уведомления в настройках Android',permission_requested:'Разреши уведомления в окне Android',disabled:'Напоминание выключено'}[result.status])||'Проверь настройки уведомлений');if(screen==='settings')render();}catch{toast('Не удалось прочитать ответ настроек');}},
  nativeShareResult(id,status){if(status==='opened')toast('Выбери мессенджер и папу — отправка в твоих руках');else toast('Не удалось открыть отправку. Попробуй сохранить картинку.');},
  handleBack(){if(dialog.open){cancelStop();return true;}if(screen!=='home'){handleAction('back',document.createElement('button'));return true;}return false;}
};
// Preview data exists only on the local review server and uses a separate store.
function demoResult(){return {id:'preview-example',exercise:'pushup',mode:'free',goal:null,actual:10,source:'camera-estimate',demo:true,startedAt:new Date(Date.now()-76000).toISOString(),endedAt:new Date().toISOString(),trackedFrames:96,lostFrames:3,reward:{coins:20,xp:50}};}
if(DEMO){
  window.MovePreview={show(which){pauseTutorial();stopCamera();exercise=EXERCISES[params.get('exercise')]?params.get('exercise'):'pushup';lastResult=demoResult();requestMinutes=null;preparationOrigin='home';tutorialReturn='home';
    if(which==='request-report'){requestMinutes=30;screen='report';}else screen=which;
    if(['result','report'].includes(screen))completeSession(state,lastResult);
    if(screen==='workout'){session={...demoResult(),id:uid(),actual:6};tracker=createTracker({exercise});cameraPaused=false;render();updateCounter(6,true,'Демо: полный цикл засчитан');return;}
    if(screen==='progress'&&!state.history.length){const days=[0,1,3,5,6,7];Object.keys(EXERCISES).forEach((id,i)=>completeSession(state,{...demoResult(),id:`preview-${id}`,exercise:id,actual:({pushup:10,squat:20,plank:45,pullup:2,boat:15,hang:20})[id],startedAt:new Date(Date.now()-days[i]*86400000-(i+1)*60000).toISOString(),endedAt:new Date(Date.now()-days[i]*86400000).toISOString()}));}
    render();window.scrollTo(0,0);if(screen==='result')sound.reward();},sounds:()=>sound.renderDemo(),getState:()=>structuredClone(state)};
  if(params.get('screen'))window.MovePreview.show(params.get('screen'));else render();
}else {refreshNative();render();}
