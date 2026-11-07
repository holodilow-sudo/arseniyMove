let detector;
self.onmessage=async ({data})=>{
  try {
    if(data.type==='init') {
      const {FilesetResolver,PoseLandmarker}=await import('./vendor/vision_bundle.mjs');
      const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm',import.meta.url).href,true);
      detector=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/pose_landmarker_lite.task',import.meta.url).href,delegate:'CPU'},runningMode:'VIDEO',numPoses:2,minPoseDetectionConfidence:.65,minPosePresenceConfidence:.65,minTrackingConfidence:.65,outputSegmentationMasks:false});
      self.postMessage({type:'ready'});
    } else if(data.type==='frame') {
      try {const started=performance.now(),result=detector.detectForVideo(data.bitmap,data.timestamp);self.postMessage({type:'result',landmarks:result.landmarks,worldLandmarks:result.worldLandmarks,timestamp:data.timestamp,aspectRatio:data.aspectRatio,inputWidth:data.inputWidth,inputHeight:data.inputHeight,inferenceMs:performance.now()-started});}
      finally {data.bitmap.close();}
    }
  }catch(error){self.postMessage({type:'error',message:String(error?.message||error)});}
};
