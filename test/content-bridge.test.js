const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function setup(){
 const managers=[],sent=[],listeners={};
 const managerFactory=({onEvent})=>{const m={onEvent,starts:[],audio:[],stops:0,start(v){this.starts.push(v);},sendAudio(...v){this.audio.push(v);},stop(){this.stops++;}};managers.push(m);return m;};
 const chrome={storage:{local:{get:async()=>({apiKey:'private-key',myLanguage:'pt-BR'}),set:async()=>{}}},runtime:{
 onMessage:{addListener:f=>listeners.runtime=f},sendMessage:async message=>{sent.push(message);return {ok:true};}}};
 const window={postMessage:m=>sent.push(m),addEventListener:(type,f)=>listeners[type]=f};
 const sandbox={window,chrome,document:{readyState:'loading',addEventListener(){}},VozSessionManager:{createSessionManager:managerFactory},VozGemini:{createSession(){}},VozStatus:{createLatencyMeter:()=>({speech(){},output(){return null;}})},Set,Promise};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/content.js'),'utf8'),sandbox);
 const emit=event=>listeners.runtime({type:'remote-window-event',event});
 return {managers,sent,emit,listeners,window};
}
test('captura autorizada inicia tradutor remoto sem alterar sessão do microfone',async()=>{
 const h=setup();h.emit({type:'remote-ready'});await Promise.resolve();assert.equal(h.managers[1].starts.length,1);assert.equal(h.managers[0].starts.length,0);
 assert.equal(h.managers[1].starts[0].targetLanguageCode,'pt-BR');
 h.managers[1].onEvent({type:'ready'});h.emit({type:'remote-audio',data:'PCM',hasSpeech:true});assert.equal(h.managers[1].audio.length,1);
 h.emit({type:'remote-audio',data:'quiet',hasSpeech:false});assert.deepEqual(h.managers[1].audio.at(-1),['quiet',false]);
 assert.ok(!h.sent.some(m=>JSON.stringify(m).includes('private-key')));
});
test('áudio remoto postado pela página é ignorado; microfone continua passando',()=>{
 const h=setup();h.listeners.message({source:h.window,data:{source:'voz-traduzida',dir:'up',type:'remote-audio',data:'fake'}});
 assert.equal(h.managers[1].audio.length,0);
 h.managers[0].onEvent({type:'ready'});h.listeners.message({source:h.window,data:{source:'voz-traduzida',dir:'up',type:'audio',data:'mic',hasSpeech:true}});assert.equal(h.managers[0].audio.length,1);
});
test('parada durante leitura de configurações impede início atrasado',async()=>{
 const h=setup();h.emit({type:'remote-ready'});h.emit({type:'remote-ended'});await Promise.resolve();assert.equal(h.managers[1].starts.length,0);
});
