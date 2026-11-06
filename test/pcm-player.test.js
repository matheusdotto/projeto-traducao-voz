const test=require('node:test');const assert=require('node:assert/strict');
const {createPcmPlayer}=require('../src/pcm-player.js');
function harness(profile){
 const sources=[],buffers=[];
 const context={currentTime:10,createBuffer(ch,length,rate){buffers.push({ch,length,rate});return {duration:length/rate,copyToChannel(){}};},
 createBufferSource(){const s={connect(){},start(t){this.startAt=t;},stop(){this.stopped=true;}};sources.push(s);return s;}};
 return {context,sources,buffers,player:createPcmPlayer(context,{},profile)};
}
test('perfil equilibrado inicia em 120 ms, em vez da margem antiga de 200 ms',()=>{
 const h=harness();h.player.play(new Float32Array(2400));assert.equal(h.sources[0].startAt,10.12);assert.equal(h.buffers[0].rate,24000);
});
test('trechos consecutivos se emendam sem adicionar margem entre eles',()=>{
 const h=harness();h.player.play(new Float32Array(2400));h.context.currentTime=10.03;h.player.play(new Float32Array(2400));
 assert.ok(Math.abs(h.sources[1].startAt-(h.sources[0].startAt+.1))<1e-9);
});
test('falha de continuidade aumenta margem sem mudar velocidade ou taxa',()=>{
 const h=harness('fast');h.player.play(new Float32Array(2400));h.context.currentTime=10.2;h.player.play(new Float32Array(2400));
 assert.equal(h.player.stats().underruns,1);assert.equal(h.player.stats().leadMs,100);assert.ok(h.buffers.every(b=>b.rate===24000));
});
test('pausa longa entre frases não é registrada como falha de rede',()=>{
 const h=harness();h.player.play(new Float32Array(2400));h.context.currentTime=13;h.player.play(new Float32Array(2400));assert.equal(h.player.stats().underruns,0);
});
test('limpar fila interrompe fontes sem perder callback para próxima reprodução',()=>{
 const h=harness();h.player.play(new Float32Array(2400));h.player.flush();assert.equal(h.player.stats().queued,0);assert.equal(h.sources[0].stopped,true);
 h.player.play(new Float32Array(2400));assert.equal(h.player.stats().queued,1);
});
test('perfil e taxa respeitam seleção e metadados',()=>{
 const h=harness();h.player.setProfile('smooth');h.player.play(new Float32Array(4800),48000);assert.equal(h.player.stats().leadMs,220);assert.equal(h.buffers[0].rate,48000);
 h.player.setProfile('invalid');assert.equal(h.player.stats().profile,'balanced');
});
test('fila preserva todo áudio recebido; não acelera nem descarta frases',()=>{
 const h=harness();for(let i=0;i<50;i++)h.player.play(new Float32Array(2400));assert.equal(h.sources.length,50);assert.ok(h.player.stats().bufferedMs>5000);
});
