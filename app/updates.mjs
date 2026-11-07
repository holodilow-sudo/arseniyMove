const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const busy=new Set(['checking','downloading','verifying']);
export function updatePanel(status={},full=false){
  const state=String(status.state||'idle'),ready=['ready','permission'].includes(state);
  if(!full&&!ready)return '';
  const progress=Number.isFinite(status.percent)?Math.max(0,Math.min(100,status.percent)):null;
  const title=ready?`Обновление ${escape(status.version)} готово`:'Обновления приложения';
  return `<section class="panel update-panel" aria-label="Обновления приложения"><span class="eyebrow">ARSENIY MOVE</span><h2>${title}</h2><p role="status">${escape(status.message||'Проверяем новые версии при открытии приложения.')}</p>${state==='downloading'&&progress!==null?`<progress max="100" value="${progress}" aria-label="Загрузка обновления"></progress><small>${progress}%</small>`:''}${ready?'<button class="button primary" data-action="install-update">Установить обновление</button>':full?`<button class="button ghost" data-action="check-update" ${busy.has(state)?'disabled':''}>${busy.has(state)?'Подожди немного…':'Проверить обновления'}</button>`:''}${full?'<p class="footnote">Новые версии скачиваются автоматически при открытии приложения, если есть интернет. Установку подтверждаешь ты. Проверка — раз в 6 часов; кнопкой можно проверить раньше. Для установки Android может один раз попросить разрешение.</p><p class="footnote">Источник: GitHub · holodilow-sudo/arseniyMove. Интернет используется только для обновлений. Видео и история тренировок не отправляются.</p>':''}</section>`;
}
