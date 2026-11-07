// Android runtime permission is resolved before WebView asks for a video stream.
export class CameraPermissionGate {
  constructor(getBridge=()=>globalThis.MoveNative,timeoutMs=90000){this.getBridge=getBridge;this.timeoutMs=timeoutMs;this.pending=null;this.sequence=0;}
  ensure({signal,onStatus=()=>{}}={}){
    if(signal?.aborted)return Promise.reject(new DOMException('Camera request cancelled','AbortError'));
    const bridge=this.getBridge();
    if(!bridge?.requestCameraPermission)return Promise.resolve({status:'browser',granted:true});
    try{const c=JSON.parse(bridge.getCapabilities());if(c.cameraPermission&&!c.permissionPromptActive)return Promise.resolve({status:'granted',granted:true});}catch{}
    if(this.pending)return Promise.reject(Object.assign(new Error('Дождись ответа на запрос камеры.'),{permissionStatus:'busy'}));
    return new Promise((resolve,reject)=>{
      const requestId=`camera-${Date.now()}-${++this.sequence}`;
      const abort=()=>this.cancel();
      const finish=(result,error)=>{
        if(this.pending?.requestId!==requestId)return;
        clearTimeout(this.pending.timer);signal?.removeEventListener('abort',abort);this.pending=null;
        if(error)reject(error);else resolve(result);
      };
      this.pending={requestId,finish,timer:setTimeout(()=>finish(null,Object.assign(new Error('Не получен ответ Android. Нажми «Продолжить» и разреши доступ к камере.'),{permissionStatus:'timeout'})),this.timeoutMs)};
      signal?.addEventListener('abort',abort,{once:true});
      onStatus('Разреши доступ к камере в окне Android');
      try{bridge.requestCameraPermission(requestId);}catch{finish(null,new Error('Не удалось запросить разрешение камеры. Перезапусти приложение.'));}
    });
  }
  receive(result){
    try{if(typeof result==='string')result=JSON.parse(result);}catch{return false;}
    if(!result||!this.pending||result.requestId!==this.pending.requestId)return false;
    if(result.granted===true&&result.status==='granted')this.pending.finish(result);
    else{
      const message=result.status==='settings_required'?'Доступ к камере выключен. Открой разрешения приложения и включи «Камера».':result.status==='denied'?'Доступ к камере не разрешён. Нажми «Продолжить», чтобы разрешить его.':result.status==='busy'?'Сначала ответь на открытый запрос Android, затем нажми «Продолжить».':'Запрос камеры прерван. Нажми «Продолжить», когда будешь готов.';
      const error=Object.assign(new Error(message),{name:result.status==='cancelled'?'AbortError':'NotAllowedError',permissionStatus:result.status});
      this.pending.finish(null,error);
    }
    return true;
  }
  cancel(){this.pending?.finish(null,new DOMException('Camera request cancelled','AbortError'));}
}
export const cameraPermissions=new CameraPermissionGate();
