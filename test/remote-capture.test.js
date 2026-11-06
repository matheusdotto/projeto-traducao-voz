const test=require('node:test');const assert=require('node:assert/strict');
const {createRemoteCapture}=require('../src/remote-capture.js');
const audio=require('../src/audio-utils.js'),playback=require('../src/pcm-player.js');
class Track extends EventTarget{
 constructor(kind,suppressed=true){super();this.kind=kind;this.stopped=false;this.suppressed=suppressed;}
 stop(){this.stopped=true;}
 getSettings(){return this.kind==='video'?{displaySurface:this.surface||'browser'}:{suppressLocalAudioPlayback:this.suppressed};}
}
class Stream{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}}
function setup(getDisplayMedia){
 const contexts=[],events=[],timers=new Set();
 class Context{
  constructor(){this.sampleRate=48000;this.currentTime=10;this.state='running';this.destination={};this.nodes=[];this.players=[];contexts.push(this);}
  node(){const n={gain:{value:1},connections:[],connect(to){this.connections.push(to);return to;},disconnect(){this.disconnected=true;}};this.nodes.push(n);return n;}
  createMediaStreamSource(stream){this.stream=stream;return this.node();}createGain(){return this.node();}
  createScriptProcessor(){this.processor=this.node();return this.processor;}
  createBuffer(ch,length,rate){return{copyToChannel(){},duration:length/rate};}
  createBufferSource(){const s={connect(){},start(){},stop(){this.stopped=true;}};this.players.push(s);return s;}
  async resume(){}async close(){this.state='closed';}
 }
 const capture=createRemoteCapture({onEvent:e=>events.push(e),mediaDevices:{getDisplayMedia},AudioContextImpl:Context,StreamImpl:Stream,audio,playback,
 schedule:f=>{timers.add(f);return f;},cancel:f=>timers.delete(f)});
 return{capture,events,contexts,timers};
}
test('recebe PCM da aba e monitora original fora da origem capturada',async()=>{
 const a=new Track('audio'),v=new Track('video');let options;const h=setup(async o=>{options=o;return new Stream([a,v]);});
 assert.equal(await h.capture.start(),true);assert.equal(options.selfBrowserSurface,'exclude');assert.equal(options.systemAudio,'exclude');
 const c=h.contexts[0];assert.deepEqual(c.stream.getAudioTracks(),[a]);
 for(let i=0;i<8;i++)c.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1024).fill(.2)}});
 for(const report of h.timers)report();assert.ok(h.events.some(e=>e.type==='remote-audio'&&e.hasSpeech));
 const state=h.events.filter(e=>e.type==='remote-state').at(-1);assert.ok(state.peak>0);assert.equal(state.captureMode,'tab');assert.equal(state.originalMonitored,true);
 h.capture.play(audio.int16ToBase64(new Int16Array(2400)));assert.equal(c.players.length,0);
 h.capture.setVoice(true);h.capture.play(audio.int16ToBase64(new Int16Array(2400)));assert.equal(c.players.length,1);
 h.capture.stop();assert.ok(a.stopped&&v.stopped);assert.equal(h.timers.size,0);assert.equal(c.players[0].stopped,true);
});
test('seleção sem áudio ou de tela inteira é rejeitada e liberada',async()=>{
 for(const withAudio of [false,true]){const v=new Track('video');v.surface='monitor';const tracks=withAudio?[new Track('audio'),v]:[v];const h=setup(async()=>new Stream(tracks));
 assert.equal(await h.capture.start(),false);assert.ok(h.events.some(e=>e.type==='remote-error'));assert.ok(tracks.every(t=>t.stopped));}
});
test('cancelar seletor e encerrar compartilhamento informam o painel',async()=>{
 const h=setup(async()=>{throw new DOMException('cancel','NotAllowedError');});assert.equal(await h.capture.start(),false);assert.match(h.events[0].reason,/cancelada/);
 const a=new Track('audio'),v=new Track('video');const live=setup(async()=>new Stream([a,v]));await live.capture.start();v.dispatchEvent(new Event('ended'));
 assert.equal(live.events.at(-1).type,'remote-ended');assert.ok(a.stopped);assert.equal(live.timers.size,0);
});
test('parar durante o seletor impede início atrasado',async()=>{
 let resolve;const h=setup(()=>new Promise(r=>resolve=r));const pending=h.capture.start();h.capture.stop();const a=new Track('audio'),v=new Track('video');resolve(new Stream([a,v]));
 assert.equal(await pending,false);assert.ok(a.stopped&&v.stopped);assert.equal(h.contexts.length,0);
});
test('não duplica o original quando o navegador não suprimiu a saída local',async()=>{
 const h=setup(async()=>new Stream([new Track('audio',false),new Track('video')]));await h.capture.start();assert.equal(h.events.find(e=>e.type==='remote-state').originalMonitored,false);
 const c=h.contexts[0];assert.equal(c.nodes[0].connections.length,1);h.capture.stop();
});


test('voz baixa e silêncio continuam enviados, com identificação da fonte',async()=>{
 const a=new Track('audio'),v=new Track('video');v.label='Teams | chamada';
 const h=setup(async()=>new Stream([a,v]));await h.capture.start();const c=h.contexts[0];
 for(const level of [.0003,0]){
  const before=h.events.filter(e=>e.type==='remote-audio').length;
  for(let i=0;i<12;i++)c.processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(1024).fill(level)}});
  const frames=h.events.filter(e=>e.type==='remote-audio').slice(before);assert.ok(frames.length>0);assert.ok(frames.every(e=>!e.hasSpeech));
  if(level>0)assert.ok(Buffer.from(frames[0].data,'base64').some(byte=>byte!==0));
  for(const report of h.timers)report();
  const measured=h.events.filter(e=>e.type==='remote-state').at(-1);
  if(level>0)assert.ok(measured.signalDb < -60);else assert.equal(measured.signalDb,null);
  for(let i=0;i<10;i++)for(const report of h.timers)report();
  const report=h.events.filter(e=>e.type==='remote-state').at(-1);assert.equal(report.sourceLabel,'Teams | chamada');assert.ok(report.weakSeconds>=10);
 }
 h.capture.stop();
});
