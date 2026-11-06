const test=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const VozAudio=require('../src/audio-utils.js');const VozPlayback=require('../src/pcm-player.js');
class Track extends EventTarget {
 constructor(){super();this.kind='audio';this.enabled=true;this.readyState='live';this.label='mic';}
 stop(){this.readyState='ended';}
 getSettings(){return {sampleRate:48000};}getCapabilities(){return {};}getConstraints(){return {};}
 async applyConstraints(){}
}
class Stream {constructor(tracks){this.tracks=tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}}
function harness(){
 const contexts=[],messages=[],listeners={},timers=new Set();
 class Context {
  constructor(options){this.options=options;this.sampleRate=48000;this.currentTime=10;this.state='running';this.destination={};this.sources=[];contexts.push(this);}
  node(){return {gain:{value:1},connect(){return this;}};}
  createGain(){return this.node();}createMediaStreamSource(){return this.node();}
  createMediaStreamDestination(){return {stream:new Stream([new Track()])};}
  createScriptProcessor(size){this.processor=this.node();this.processor.size=size;return this.processor;}
  createBuffer(ch,length,rate){return {duration:length/rate,copyToChannel(){}};}
  createBufferSource(){const n={connect(){},start(t){this.started=t;},stop(){this.stopped=true;}};this.sources.push(n);return n;}
  async resume(){}async close(){this.state='closed';}
 }
 const microphone=new Track();
 const win={__vozTest:true,RTCPeerConnection:class extends EventTarget {},postMessage:m=>messages.push(m),addEventListener:(type,fn)=>listeners[type]=fn};
 const navigator={mediaDevices:{getUserMedia:async()=>new Stream([microphone])}};
 const sandbox={window:win,navigator,VozAudio,VozPlayback,AudioContext:Context,MediaStream:Stream,Event,
  setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),Promise};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/inject.js'),'utf8'),sandbox);
 const down=message=>listeners.message({source:win,data:{source:'voz-traduzida',dir:'down',...message}});
 return {win,navigator,contexts,messages,timers,microphone,down};
}
test('pipeline real do inject envia silêncio contínuo, respeita mudo e restaura voz original',async()=>{
 const h=harness();const stream=await h.navigator.mediaDevices.getUserMedia({audio:true});const track=stream.getAudioTracks()[0];const ctx=h.contexts[0];
 assert.equal(ctx.processor.size,1024);assert.equal(ctx.options.latencyHint,'interactive');
 const tick=()=>ctx.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1024)}});
 tick();assert.equal(h.messages.filter(m=>m.type==='audio').length,0);
 h.down({type:'set-mode',mode:'translated'});for(let i=0;i<8;i++)tick();
 const audio=h.messages.filter(m=>m.type==='audio');assert.ok(audio.length>0);assert.ok(audio.every(m=>m.hasSpeech===false));
 assert.equal(h.win.__vozDebug.micGain(),0);
 track.enabled=false;tick();const mark=h.messages.filter(m=>m.type==='audio').length;for(let i=0;i<8;i++)tick();
 assert.equal(h.messages.filter(m=>m.type==='audio').length,mark);
 h.down({type:'play',data:VozAudio.int16ToBase64(new Int16Array(2400))});assert.equal(ctx.sources.length,0);
 track.enabled=true;tick();h.down({type:'playback-profile',profile:'fast'});
 h.down({type:'play',data:VozAudio.int16ToBase64(new Int16Array(2400))});assert.equal(ctx.sources[0].started,10.06);
 h.down({type:'set-mode',mode:'original'});assert.equal(h.win.__vozDebug.micGain(),1);assert.equal(ctx.sources[0].stopped,true);
 track.stop();assert.equal(h.microphone.readyState,'ended');assert.equal(h.timers.size,0);
});
