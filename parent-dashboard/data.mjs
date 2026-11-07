export const exercises={pushup:['Отжимания','раз'],squat:['Приседания','раз'],plank:['Планка','с'],pullup:['Подтягивания','раз'],boat:['Лодочка','с'],hang:['Вис на турнике','с']};
export function shift(day,n){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function dateKey(date=new Date(),zone='Asia/Chita'){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
const validDay=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const number=(n,max=1e9)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=max;
export function validate(input){
 if(!input||input.schema!==1||!Array.isArray(input.days)||input.days.length>5000)throw Error('Формат статистики не поддерживается.');
 const zone=input.timezone||'Asia/Chita';dateKey(new Date(),zone);
 if(input.uploadedAt!==null&&(!input.uploadedAt||!Number.isFinite(Date.parse(input.uploadedAt))))throw Error('В статистике нет даты синхронизации.');
 const seen=new Set(),days=input.days.map(row=>{
  if(!row||!validDay(row.day)||seen.has(row.day)||!number(row.sets,100000)||row.sets<1||!number(row.seconds)||!number(row.unknownDuration,100000)||row.unknownDuration>row.sets)throw Error('Ошибка в записи тренировки.');
  seen.add(row.day);const clean={};
  for(const [id,n] of Object.entries(row.exercises||{})){if(!Object.hasOwn(exercises,id)||!number(n))throw Error('Неизвестное упражнение или результат.');clean[id]=n;}
  return {day:row.day,sets:row.sets,seconds:row.seconds,unknownDuration:row.unknownDuration,exercises:clean};
 }).sort((a,b)=>a.day.localeCompare(b.day));
 if(days.length&&!input.uploadedAt)throw Error('Не указана синхронизация результатов.');
 return {schema:1,timezone:zone,uploadedAt:input.uploadedAt,days};
}
export function summary(data,period=7,now=new Date()){
 const today=dateKey(now,data.timezone),synced=data.uploadedAt?dateKey(new Date(data.uploadedAt),data.timezone):null;
 const map=new Map(data.days.filter(r=>r.day<=today).map(r=>[r.day,r]));const first=[...map.keys()].sort()[0]||null;
 function status(day){if(map.has(day))return 'active';if(!synced||day>synced||!first||day<first)return 'unknown';return 'empty';}
 const rows=Array.from({length:period},(_,i)=>{const day=shift(today,i-period+1);return {...(map.get(day)||{day,sets:0,seconds:0,unknownDuration:0,exercises:{}}),status:status(day)};});
 let cursor=map.has(today)?today:shift(today,-1),streak=0;while(map.has(cursor)){streak++;cursor=shift(cursor,-1);}
 const stale=synced&&synced<shift(today,-1);
 return {today,synced,map,rows,status,stale,streak:stale?null:streak,active:rows.filter(r=>r.sets).length,seconds:rows.reduce((n,r)=>n+r.seconds,0),unknown:rows.reduce((n,r)=>n+r.unknownDuration,0)};
}
export function duration(s){if(s<60)return `${s} с`;if(s<3600)return `${Math.floor(s/60)} мин`;return `${Math.floor(s/3600)} ч ${Math.floor(s%3600/60)} м`;}
export function demoData(now=new Date()){
 const today=dateKey(now),minutes=[16,0,18,22,14,20,18];return {schema:1,timezone:'Asia/Chita',uploadedAt:now.toISOString(),days:minutes.flatMap((m,i)=>m?[{day:shift(today,i-6),sets:3,seconds:m*60,unknownDuration:0,exercises:{squat:24+i,pushup:12+i,plank:30+i*5}}]:[])};
}
