// Capture compatibility and cancellation. No microphone, recording, or network.
const retryable=new Set(['OverconstrainedError','ConstraintNotSatisfiedError','NotFoundError','NotReadableError','AbortError']);
const cancelled=()=>new DOMException('Camera request cancelled','AbortError');

function bounded(operation,{signal,timeoutMs,code,dispose=()=>{}}){
  if(signal?.aborted)return Promise.reject(cancelled());
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>finish(cancelled());
    const timer=setTimeout(()=>finish(Object.assign(new Error(code),{code})),timeoutMs);
    signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{if(done)throw cancelled();return operation();}).then(value=>{if(done){dispose(value);return;}finish(null,value);},error=>finish(error));
  });
}

export async function openCamera({mediaDevices,facing='user',signal,onStatus=()=>{},timeoutMs=15000}){
  // Some Android cameras reject a constrained profile even after access is granted.
  // Fall back only after a hardware/constraint failure, never after a permission denial.
  const profiles=[{facingMode:{ideal:facing},width:{ideal:640},height:{ideal:480},frameRate:{ideal:15}},
    {facingMode:{ideal:facing}},true];
  for(let i=0;i<profiles.length;i++){
    if(signal?.aborted)throw cancelled();
    if(i)onStatus('Пробуем совместимый режим камеры…');
    try{
      return await bounded(()=>mediaDevices.getUserMedia({audio:false,video:profiles[i]}),{
        signal,timeoutMs,code:'CAPTURE_TIMEOUT',dispose:stream=>stream.getTracks().forEach(track=>track.stop())});
    }catch(error){
      // An unresolved timed-out request must not race a second camera request.
      if(signal?.aborted||!retryable.has(error.name)||i===profiles.length-1)throw error;
    }
  }
}

export function playCamera(video,{signal,timeoutMs=12000}={}){
  video.muted=true;video.autoplay=true;video.playsInline=true;
  return bounded(()=>video.play(),{signal,timeoutMs,code:'PREVIEW_TIMEOUT'});
}
