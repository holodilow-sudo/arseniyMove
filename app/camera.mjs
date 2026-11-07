import {cameraPermissions} from './camera-permission.mjs';
import {openCamera,playCamera} from './camera-stream.mjs';
const EDGES=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
export class VisionCamera {
  constructor(){this.generation=0;this.stream=null;this.worker=null;this.detector=null;this.frame=0;this.timer=0;this.running=false;this.busy=false;this.lastTime=-1;this.captureCanvas=null;this.captureContext=null;}
  async start({video,canvas,onResult,onStatus=()=>{},onPreview=()=>{},onError,facing='user'}){
    this.stop();const generation=this.generation;this.video=video;this.canvas=canvas;this.onResult=onResult;this.onError=onError;
    const live=()=>generation===this.generation;
    const controller=new AbortController();this.permissionAbort=controller;
    let stage='permission';
    try {
      await cameraPermissions.ensure({signal:controller.signal,onStatus});
      if(!live())return;
      if(!navigator.mediaDevices?.getUserMedia)throw Object.assign(new Error('Камера недоступна в этой версии Android System WebView. Обнови Android System WebView / Chrome через магазин приложений.'),{code:'MEDIA_API_UNAVAILABLE'});
      stage='capture';onStatus('Подключаем камеру…');
      const stream=await openCamera({mediaDevices:navigator.mediaDevices,facing,signal:controller.signal,onStatus});
      if(!live()){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;video.srcObject=stream;stage='preview';await playCamera(video,{signal:controller.signal});if(!live())return;
      onPreview({facing:stream.getVideoTracks()[0]?.getSettings?.().facingMode||facing});
      stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(live()){this.stop();onError('Камера остановилась. Нажми «Продолжить», когда она снова будет доступна.',{code:'TRACK_ENDED',stage:'capture'});}}));
      stage='model';onStatus('Камера подключена. Загружаем подсчёт движений…');
      try { await this.initWorker(); }
      catch(error) {
        if(!live())return;
        this.cancelInit?.();this.cancelInit=null;this.worker?.terminate();this.worker=null;
        onStatus('Камера подключена. Настраиваем совместимый режим подсчёта…');
        const loadDetector=async()=>{
          const {FilesetResolver,PoseLandmarker}=await import('./vendor/vision_bundle.mjs');
          const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',import.meta.url).href);
          const detector=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/pose_landmarker_lite.task',import.meta.url).href,delegate:'CPU'},runningMode:'VIDEO',numPoses:2,minPoseDetectionConfidence:.65,minPosePresenceConfidence:.65,minTrackingConfidence:.65});
          if(!live()){detector.close();return null;}return detector;
        };
        let timer;
        try{this.detector=await Promise.race([loadDetector(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Recognition startup timed out'),{code:'MODEL_TIMEOUT'})),45000);})]);}
        finally{clearTimeout(timer);}
      }
      if(!live())return;
      this.running=true;this.busy=false;this.lastTime=-1;this.lastFrame=0;
      onStatus('Встань целиком в кадр');this.loop();
    }catch(error){if(live()){
      this.stop();
      const code=error.permissionStatus||(typeof error.code==='string'?error.code:error.name)||'UNKNOWN';
      const message=error.permissionStatus?error.message:stage==='model'?'Камера подключилась, но подсчёт движений не загрузился. Обнови Android System WebView / Chrome и попробуй снова.':code==='CAPTURE_TIMEOUT'?'Телефон не ответил на подключение камеры. Закрой приложение, открой снова и попробуй другую камеру.':stage==='preview'?'Камера найдена, но изображение не появилось. Попробуй другую камеру или обнови Android System WebView / Chrome.':error.name==='NotAllowedError'?'Доступ к камере не разрешён. Разреши его в настройках приложения и проверь переключатель «Доступ к камере» в Android.':error.name==='NotFoundError'?'Выбранная камера недоступна. Попробуй переключить на другую.':error.name==='NotReadableError'?'Не удалось получить изображение. Закрой другие приложения с камерой и проверь переключатель «Доступ к камере» в Android.':error.name==='AbortError'?'Подключение камеры прервалось. Нажми «Продолжить», чтобы повторить.':String(error.message||'Не удалось запустить камеру.');
      onError(message,{code:String(code),stage,reason:String(error.message||'').slice(0,300),settings:error.permissionStatus==='settings_required'||(stage!=='preview'&&error.name==='NotAllowedError')});
    }}
  }
  initWorker(){return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./vision-worker.mjs',import.meta.url),{type:'module'});this.worker=worker;
    const generation=this.generation,live=()=>generation===this.generation&&this.worker===worker;
    const timer=setTimeout(()=>reject(new Error('Model startup timeout')),30000);
    this.cancelInit=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};
    worker.onerror=e=>{if(!live())return;clearTimeout(timer);reject(new Error(e.message));if(this.running){this.stop();this.onError('Распознавание остановилось. Нажми «Продолжить».',{stage:'model',code:'WORKER_ERROR',reason:String(e.message||'').slice(0,300)});}};
    worker.onmessage=({data})=>{
      if(!live())return;
      if(data.type==='ready'){clearTimeout(timer);this.cancelInit=null;resolve();}
      if(data.type==='error'){clearTimeout(timer);reject(new Error(data.message));if(this.running){this.stop();this.onError('Не удалось обработать кадр. Попробуй продолжить.',{stage:'model',code:'FRAME_ERROR',reason:String(data.message||'').slice(0,300)});}}
      if(data.type==='result'){this.busy=false;clearTimeout(this.timer);if(this.running)this.deliver(data);}
    };worker.postMessage({type:'init'});
  });}
  loop(){
    if(!this.running)return;this.frame=requestAnimationFrame(()=>this.loop());const now=performance.now();
    if(this.busy||this.video.readyState<2||this.video.currentTime===this.lastTime||now-(this.lastFrame||0)<125)return;
    this.lastFrame=now;this.lastTime=this.video.currentTime;this.busy=true;
    let frame;
    try{frame=this.prepareFrame();}catch(error){this.stop();this.onError('Не удалось подготовить кадр камеры.',{stage:'capture',code:'FRAME_PREPARE',reason:String(error?.message||error).slice(0,300)});return;}
    if(this.worker){const generation=this.generation,worker=this.worker;
      createImageBitmap(this.captureCanvas).then(bitmap=>{
        if(generation!==this.generation||!this.running||this.worker!==worker){bitmap.close();return;}
        try{worker.postMessage({type:'frame',bitmap,...frame},[bitmap]);}
        catch(error){bitmap.close();throw error;}
        this.timer=setTimeout(()=>{if(generation===this.generation&&this.running){this.stop();this.onError('Обработка идёт слишком медленно. Перезапусти камеру.',{stage:'model',code:'FRAME_TIMEOUT'});}},5000);
      }).catch(error=>{if(generation!==this.generation)return;this.busy=false;this.stop();this.onError('Не удалось прочитать кадр камеры.',{stage:'capture',code:'FRAME_READ',reason:String(error?.message||error).slice(0,300)});});
    }else{
      try{const started=performance.now(),r=this.detector.detectForVideo(this.captureCanvas,frame.timestamp);this.deliver({...r,...frame,inferenceMs:performance.now()-started});}
      catch(error){this.stop();this.onError('Распознавание остановилось. Попробуй продолжить.',{stage:'model',code:'FRAME_ERROR',reason:String(error?.message||error).slice(0,300)});}
      finally{this.busy=false;}
    }
  }
  prepareFrame(){
    const width=this.video.videoWidth,height=this.video.videoHeight;
    if(!(width>0&&height>0))throw new Error('Video dimensions unavailable');
    const scale=Math.min(1,640/Math.max(width,height)),inputWidth=Math.max(1,Math.round(width*scale)),inputHeight=Math.max(1,Math.round(height*scale));
    if(!this.captureCanvas){this.captureCanvas=document.createElement('canvas');this.captureContext=this.captureCanvas.getContext('2d',{alpha:false});}
    const c=this.captureCanvas;
    if(c.width!==inputWidth)c.width=inputWidth;if(c.height!==inputHeight)c.height=inputHeight;
    // A single reusable surface caps readback cost even if Android's fallback
    // capture profile supplies 1080p/4K. The busy flag prevents concurrent writes.
    const timestamp=performance.now();this.captureContext.drawImage(this.video,0,0,inputWidth,inputHeight);
    return {timestamp,inputWidth,inputHeight,aspectRatio:inputWidth/inputHeight};
  }
  deliver(data){
    const many=data.landmarks?.length>1,lm=many?[]:(data.landmarks?.[0]||[]),wm=many?[]:(data.worldLandmarks?.[0]||[]);
    this.draw(lm,data.inputWidth,data.inputHeight);this.onResult({landmarks:lm,worldLandmarks:wm,timestamp:data.timestamp,aspectRatio:data.aspectRatio||this.video.videoWidth/this.video.videoHeight,multiplePeople:many,inferenceMs:data.inferenceMs,inputWidth:data.inputWidth,inputHeight:data.inputHeight});
  }
  draw(points,inputWidth,inputHeight){
    const c=this.canvas,width=inputWidth||640,height=inputHeight||480;if(c.width!==width)c.width=width;if(c.height!==height)c.height=height;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle='#d7ff5f';ctx.fillStyle='#fff';ctx.lineWidth=3;
    const visible=i=>points[i]&&points[i].visibility>.65;
    for(const [a,b]of EDGES){if(!visible(a)||!visible(b))continue;ctx.beginPath();ctx.moveTo(points[a].x*c.width,points[a].y*c.height);ctx.lineTo(points[b].x*c.width,points[b].y*c.height);ctx.stroke();}
    for(const i of [11,12,13,14,15,16,23,24,25,26,27,28])if(visible(i)){ctx.beginPath();ctx.arc(points[i].x*c.width,points[i].y*c.height,4,0,Math.PI*2);ctx.fill();}
  }
  stop(){this.generation++;this.permissionAbort?.abort();this.permissionAbort=null;this.running=false;cancelAnimationFrame(this.frame);clearTimeout(this.timer);this.cancelInit?.();this.cancelInit=null;this.worker?.terminate();this.worker=null;try{this.detector?.close();}catch{}this.detector=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;if(this.video)this.video.srcObject=null;this.captureCanvas=null;this.captureContext=null;this.busy=false;}
}
