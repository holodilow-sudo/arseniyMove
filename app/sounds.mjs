let context=null, enabled=true, nodes=new Set();
function tone(hz,duration,delay=0,volume=.045,type='sine', ctx=context){
  if(!ctx)return; const osc=ctx.createOscillator(),gain=ctx.createGain(),start=ctx.currentTime+delay;
  osc.type=type;osc.frequency.value=hz;gain.gain.setValueAtTime(.0001,start);gain.gain.exponentialRampToValueAtTime(volume,start+.008);gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  osc.connect(gain);gain.connect(ctx.destination);osc.start(start);osc.stop(start+duration+.02);nodes.add(osc);osc.onended=()=>{nodes.delete(osc);osc.disconnect();gain.disconnect();};
}
export const sound={
  set(v){enabled=!!v;if(!enabled)this.stop();},
  unlock(){if(!enabled)return;try{context ||= new (window.AudioContext||window.webkitAudioContext)();if(context.state==='suspended')context.resume().catch(()=>{});}catch{}},
  tap(){if(!enabled)return;this.unlock();tone(780,.04,0,.018);tone(1150,.035,.018,.009);},
  count(){if(!enabled)return;this.unlock();tone(660,.10,0,.035);tone(880,.14,.06,.024);},
  reward(){if(!enabled)return;this.unlock();[392,523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f,.35,i*.1,.035,'triangle'));[0,1,2,3,4].forEach(i=>tone(1400+i*80,.09,.8+i*.12,.015));},
  stop(){for(const n of nodes){try{n.stop();}catch{}}nodes.clear();},
  async renderDemo(){const c=new OfflineAudioContext(1,48000*3,48000);tone(780,.04,0,.02,'sine',c);tone(660,.1,.3,.035,'sine',c);tone(880,.14,.36,.025,'sine',c);[392,523.25,659.25,783.99,1046.5].forEach((f,i)=>tone(f,.35,.9+i*.1,.035,'triangle',c));[0,1,2,3,4].forEach(i=>tone(1400+i*80,.09,1.7+i*.12,.015,'sine',c));return c.startRendering();}
};
