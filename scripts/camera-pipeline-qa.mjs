import assert from 'node:assert/strict';
import fs from 'node:fs';
import {VisionCamera} from '../app/camera.mjs';

// Lifecycle/size regressions use controlled browser primitives, not a webcam.
let clock=300,draws=[],surfaces=[],bitmaps=[],pending=[],workers=[];
const saved=Object.fromEntries(['document','performance','requestAnimationFrame','cancelAnimationFrame','createImageBitmap','Worker'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
const context=()=>({drawImage(...args){draws.push(args);},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},arc(){},fill(){}});
class FakeWorker {
 constructor(){this.messages=[];workers.push(this);}
 postMessage(data){if(data.type==='init')queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));else this.messages.push(data);}
 terminate(){this.terminated=true;}
 result(packet){this.onmessage({data:{...packet,type:'result',landmarks:[],worldLandmarks:[],inferenceMs:287}});}
}
function globals(){
 Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>clock}});
 globalThis.document={createElement(tag){assert.equal(tag,'canvas');const c={width:300,height:150,getContext:()=>context()};surfaces.push(c);return c;}};
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};globalThis.Worker=FakeWorker;
 globalThis.createImageBitmap=canvas=>new Promise(resolve=>pending.push(()=>{const b={width:canvas.width,height:canvas.height,closed:0,close(){this.closed++;}};bitmaps.push(b);resolve(b);}));
}
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
function camera(width,height){const c=new VisionCamera();c.video={videoWidth:width,videoHeight:height,currentTime:1,readyState:4,srcObject:null};c.canvas={width:0,height:0,getContext:()=>context()};c.running=true;c.lastFrame=0;c.results=[];c.errors=[];c.onResult=r=>c.results.push(r);c.onError=(...e)=>c.errors.push(e);return c;}
const tests=[];
async function test(name,fn){draws=[];surfaces=[];pending=[];bitmaps=[];workers=[];clock=300;await fn();tests.push({name,passed:true});console.log('PASS '+name);}
try{
 globals();
 await test('640×480 frames retain dimensions, aspect and capture timestamp',async()=>{
  const c=camera(640,480);await c.initWorker();c.loop();pending.shift()();await flush();
  const f=c.worker.messages[0];assert.equal(f.inputWidth,640);assert.equal(f.inputHeight,480);assert.equal(f.aspectRatio,4/3);assert.equal(f.timestamp,300);
  c.worker.result(f);assert.equal(c.results[0].inferenceMs,287);assert.equal(c.results[0].inputWidth,640);assert.equal(c.canvas.width,640);assert.equal(c.busy,false);c.stop();
 });
 await test('1080p and 4K are resized before bitmap transfer; portrait aspect is retained',async()=>{
  for(const [width,height,outW,outH]of[[1920,1080,640,360],[3840,2160,640,360],[1080,1920,360,640],[320,240,320,240]]){
   const c=camera(width,height);await c.initWorker();c.loop();assert.equal(surfaces.at(-1).width,outW);assert.equal(surfaces.at(-1).height,outH);
   pending.shift()();await flush();const f=c.worker.messages[0];assert.equal(f.bitmap.width,outW);assert.equal(f.bitmap.height,outH);assert.equal(f.aspectRatio,outW/outH);c.stop();
  }
 });
 await test('Busy worker has one in-flight frame and one reusable capture surface',async()=>{
  const c=camera(1920,1080);await c.initWorker();c.loop();clock+=150;c.video.currentTime+=.2;c.loop();assert.equal(draws.length,1);assert.equal(pending.length,1);
  pending.shift()();await flush();clock+=150;c.loop();assert.equal(c.worker.messages.length,1);assert.equal(draws.length,1);
  c.worker.result(c.worker.messages[0]);clock+=150;c.loop();assert.equal(draws.length,2);assert.equal(surfaces.length,1);pending.shift()();await flush();assert.equal(c.worker.messages.length,2);c.stop();
 });
 await test('Stopping during async readback closes late bitmap without posting it',async()=>{
  const c=camera(1920,1080);await c.initWorker();const w=c.worker;c.loop();c.stop();pending.shift()();await flush();assert.equal(bitmaps[0].closed,1);assert.equal(w.messages.length,0);assert.equal(c.captureCanvas,null);assert.equal(c.results.length,0);
 });
 await test('Bitmap is closed if transfer fails and no frame timer remains active',async()=>{
  const c=camera(1920,1080);await c.initWorker();c.worker.postMessage=()=>{throw new Error('transfer failed');};c.loop();pending.shift()();await flush();assert.equal(bitmaps[0].closed,1);assert.equal(c.running,false);assert.equal(c.errors[0][1].code,'FRAME_READ');
 });
 await test('Main-thread fallback uses the resized surface and blocks reentrant capture',async()=>{
  const c=camera(1920,1080);let detected;
  c.detector={detectForVideo(input,timestamp){detected={input,timestamp};clock+=320;c.video.currentTime+=.3;c.loop();return{landmarks:[],worldLandmarks:[]};},close(){}};
  c.loop();assert.equal(detected.input,surfaces[0]);assert.equal(detected.input.width,640);assert.equal(detected.input.height,360);assert.equal(detected.timestamp,300);assert.equal(draws.length,1);assert.equal(c.results[0].inferenceMs,320);assert.equal(c.results[0].timestamp,300);assert.equal(c.results[0].aspectRatio,16/9);assert.equal(c.busy,false);c.stop();
 });
 await test('Video dimension changes resize the existing capture surface',async()=>{
  const c=camera(1920,1080);c.prepareFrame();const original=c.captureCanvas;c.video.videoWidth=1080;c.video.videoHeight=1920;const f=c.prepareFrame();assert.equal(c.captureCanvas,original);assert.equal(surfaces.length,1);assert.equal(f.inputWidth,360);assert.equal(f.inputHeight,640);c.stop();
 });
 fs.writeFileSync(new URL('../docs/camera-pipeline-qa.json',import.meta.url),JSON.stringify({passed:true,syntheticOnly:true,physicalCameraTested:false,checkedAt:new Date().toISOString(),checks:tests.length,tests},null,2));
}finally{
 for(const [key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
}
