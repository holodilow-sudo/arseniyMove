import {EXERCISES} from './state.mjs';
function text(c,s,x,y,size,color='#f4f1e6',weight=700){c.fillStyle=color;c.font=`${weight} ${size}px Arial`;c.fillText(String(s),x,y);}
function round(c,x,y,w,h,r,color){c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();}
export function createReport(session,{demo=false,minutes=null}={}){
  demo=demo||session.demo===true;
  const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;const c=canvas.getContext('2d');
  c.fillStyle='#10171f';c.fillRect(0,0,1080,1350);c.strokeStyle='#25332e';c.lineWidth=3;
  for(let i=0;i<8;i++){c.beginPath();c.arc(920,180,100+i*54,0,Math.PI*2);c.stroke();}
  round(c,64,68,128,44,22,'#d7ff5f');text(c,'MOVE',87,99,25,'#10171f',900);text(c,'РЕЗУЛЬТАТ АРСЕНИЯ',64,182,26,'#afbcbe');
  text(c,demo?'ПРИМЕР ОТЧЁТА':'ТРЕНИРОВКА',64,272,64);text(c,demo?'ДЕМО-ДАННЫЕ':'ЗАВЕРШЕНА',64,347,64,'#d7ff5f');
  text(c,EXERCISES[session.exercise].name,64,452,42);
  text(c,Math.floor(session.actual),64,582,110,'#d7ff5f',900);
  text(c,['plank','boat','hang'].includes(session.exercise)?'секунд засчитано':'повторов засчитано',68,633,28,'#afbcbe');
  round(c,64,698,952,150,26,'#1d282f');
  text(c,'СПОСОБ ПОДСЧЁТА',92,743,22,'#afbcbe');text(c,demo?'Демонстрационный результат':'Оценка движений камерой',92,793,34);
  text(c,new Date(session.endedAt).toLocaleString('ru-RU',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}),64,905,28);
  if(minutes){round(c,64,951,952,165,26,'#d7ff5f');text(c,`Папа, можно ${minutes} минут`,93,1015,38,'#10171f',900);text(c,'в интернете?',93,1067,38,'#10171f',900);}
  else {text(c,'Делюсь своим прогрессом!',64,1020,40);text(c,'Каждый шаг считается.',64,1072,32,'#afbcbe');}
  text(c,demo?'Это макет. Реальная тренировка не проводилась.':'Камера считает движения, но не проверяет технику.',64,1192,24,'#afbcbe',400);
  text(c,minutes?'Время в интернете одобряет папа.':'Видео не записывается и не отправляется.',64,1236,24,'#afbcbe',400);
  text(c,'ARSENIY MOVE',64,1300,24,'#d7ff5f',900);return canvas;
}
export async function canvasBlob(canvas){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать картинку')),'image/png'));}
export async function saveReport(canvas){const blob=await canvasBlob(canvas);const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='Arseniy-Move-result.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export async function shareReport(canvas,requestId){
  if(window.AndroidShare?.shareImage){window.AndroidShare.shareImage(canvas.toDataURL('image/png'),requestId);return 'native';}
  const file=new File([await canvasBlob(canvas)],'Arseniy-Move-result.png',{type:'image/png'});
  if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:'Результат Арсения'});return 'shared';}
  await saveReport(canvas);return 'saved';
}
