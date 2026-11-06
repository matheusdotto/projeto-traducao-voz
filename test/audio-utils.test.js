const test = require("node:test");
const assert = require("node:assert/strict");
const {
  downsampleTo16k,
  createChunker,
  int16ToBase64,
  base64ToFloat32,
  createSpeechGate,
  nextPlayTime,
  withVoiceProcessing,
} = require("../src/audio-utils.js");

const silence = () => new Int16Array(1600);
const speech = () => new Int16Array(1600).fill(8000);

test("downsampleTo16k reduz 48 kHz para um terço das amostras", () => {
  assert.equal(downsampleTo16k(new Float32Array(4800), 48000).length, 1600);
});

test("downsampleTo16k mantém o tamanho a 16 kHz", () => {
  assert.equal(downsampleTo16k(new Float32Array(1600), 16000).length, 1600);
});

test("downsampleTo16k limita valores fora da faixa", () => {
  const out = downsampleTo16k(Float32Array.of(2, -2), 16000);
  assert.equal(out[0], 32767);
  assert.equal(out[1], -32768);
});

test("downsampleTo16k não perde amostras entre blocos consecutivos de 44,1 kHz", () => {
  const out = downsampleTo16k(new Float32Array(4410), 44100);
  assert.equal(out.length, 1600);
});

test("createChunker agrupa em blocos e guarda o resto", () => {
  const chunker = createChunker(1600);
  assert.equal(chunker.push(new Int16Array(1000)).length, 0);
  const blocks = chunker.push(new Int16Array(1000));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].length, 1600);
  const next = chunker.push(new Int16Array(1200));
  assert.equal(next.length, 1, "os 400 guardados completam o próximo bloco");
});

test("base64 ida e volta devolve os valores normalizados", () => {
  const out = base64ToFloat32(int16ToBase64(Int16Array.of(0, 16384, -32768)));
  assert.equal(out.length, 3);
  assert.ok(Math.abs(out[0]) < 0.001);
  assert.ok(Math.abs(out[1] - 0.5) < 0.001);
  assert.ok(Math.abs(out[2] + 1) < 0.001);
});

test("speech gate não envia nada em silêncio", () => {
  const gate = createSpeechGate({});
  for (let i = 0; i < 20; i++) {
    const r = gate.push(silence());
    assert.equal(r.send.length, 0);
    assert.equal(r.ended, false);
  }
});

test("speech gate envia os 3 blocos anteriores quando a fala se confirma", () => {
  const gate = createSpeechGate({});
  for (let i = 0; i < 5; i++) gate.push(silence());
  assert.equal(gate.push(speech()).send.length, 0, "um bloco só ainda pode ser um clique");
  assert.equal(gate.push(speech()).send.length, 5);
  assert.equal(gate.push(speech()).send.length, 1);
});

test("speech gate ignora cliques isolados, como os de digitação", () => {
  const gate = createSpeechGate({});
  for (let i = 0; i < 30; i++) {
    assert.equal(gate.push(i % 3 === 0 ? speech() : silence()).send.length, 0);
  }
});

test("speech gate envia 50 blocos de silêncio e sinaliza o fim uma única vez", () => {
  const gate = createSpeechGate({});
  gate.push(speech());
  gate.push(speech());
  let endedCount = 0;
  for (let i = 1; i <= 50; i++) {
    const r = gate.push(silence());
    assert.equal(r.send.length, 1, `bloco ${i} ainda é enviado`);
    assert.equal(r.ended, i === 50);
    if (r.ended) endedCount++;
  }
  const after = gate.push(silence());
  assert.equal(after.send.length, 0);
  assert.equal(after.ended, false);
  assert.equal(endedCount, 1);
});

test("speech gate abre com fala baixa em ambiente silencioso", () => {
  const gate = createSpeechGate({});
  for (let i = 0; i < 20; i++) gate.push(silence());
  const quiet = new Int16Array(1600).fill(230); // RMS de cerca de 0,007
  gate.push(quiet);
  assert.ok(gate.push(quiet).send.length > 0);
});

test("speech gate para de enviar ruído constante depois de se adaptar", () => {
  const gate = createSpeechGate({});
  const noise = () => new Int16Array(1600).fill(650); // RMS de cerca de 0,02
  gate.push(noise());
  assert.ok(gate.push(noise()).send.length > 0, "no início parece fala");
  for (let i = 0; i < 200; i++) gate.push(noise());
  assert.equal(gate.push(noise()).send.length, 0);
});

test("speech gate ainda detecta fala normal depois de se adaptar ao ruído", () => {
  const gate = createSpeechGate({});
  const noise = () => new Int16Array(1600).fill(650);
  for (let i = 0; i < 200; i++) gate.push(noise());
  gate.push(speech());
  assert.ok(gate.push(speech()).send.length > 0);
});

test("speech gate não encerra quando a fala volta durante a pausa", () => {
  const gate = createSpeechGate({});
  gate.push(speech());
  gate.push(speech());
  for (let i = 0; i < 49; i++) assert.equal(gate.push(silence()).ended, false);
  assert.equal(gate.push(speech()).ended, false);
  for (let i = 0; i < 49; i++) assert.equal(gate.push(silence()).ended, false);
  assert.equal(gate.push(silence()).ended, true);
});

test("speech gate diz se o bloco tem fala", () => {
  const gate = createSpeechGate({});
  assert.equal(gate.push(speech()).hasSpeech, true);
  assert.equal(gate.push(silence()).hasSpeech, false);
});

test("nextPlayTime cria uma folga quando a fila está vazia", () => {
  assert.equal(nextPlayTime(10, 0, 0.3), 10.3);
  assert.equal(nextPlayTime(10, 9.5, 0.3), 10.3);
});

test("nextPlayTime emenda o trecho no anterior quando ainda há fila", () => {
  assert.equal(nextPlayTime(10, 10.5, 0.3), 10.5);
});

const FILTERS = { noiseSuppression: true, echoCancellation: true, autoGainControl: false };

test("withVoiceProcessing liga os filtros em um pedido simples de áudio", () => {
  assert.deepEqual(withVoiceProcessing({ audio: true, video: true }), {
    audio: FILTERS,
    video: true,
  });
});

test("withVoiceProcessing mantém o microfone escolhido e substitui filtros desligados", () => {
  const result = withVoiceProcessing({
    audio: { deviceId: { exact: "abc" }, noiseSuppression: false, echoCancellation: false },
  });
  assert.deepEqual(result.audio, { deviceId: { exact: "abc" }, ...FILTERS });
});

test("withVoiceProcessing não altera pedidos sem áudio", () => {
  const constraints = { video: true };
  assert.equal(withVoiceProcessing(constraints), constraints);
  assert.equal(withVoiceProcessing(undefined), undefined);
});

test("withVoiceProcessing desliga os filtros de ruído e volume, mantendo o cancelamento de eco", () => {
  const result = withVoiceProcessing({ audio: { deviceId: "abc" } }, false);
  assert.deepEqual(result.audio, {
    deviceId: "abc",
    noiseSuppression: false,
    echoCancellation: true,
    autoGainControl: false,
  });
});

test('reamostragem contínua de 44,1 kHz mantém fase e contagem entre callbacks',()=>{
 const {createResampler}=require('../src/audio-utils.js');
 const input=Float32Array.from({length:44100},(_,i)=>Math.sin(i*0.04)*0.5);
 const whole=createResampler(44100).push(input);
 const live=createResampler(44100);const pieces=[];
 for(let i=0;i<input.length;i+=1024)pieces.push(...live.push(input.subarray(i,i+1024)));
 assert.equal(whole.length,16000);assert.deepEqual(Int16Array.from(pieces),whole);
});
test('reamostragem mantém 16 kHz sem alterar sinal ou amplitude',()=>{
 const {createResampler}=require('../src/audio-utils.js');
 const out=createResampler(16000).push(Float32Array.of(-1,0,0.5,1));
 assert.deepEqual([...out],[-32768,0,16383,32767]);
});
test('monitor de fala apenas classifica e não elimina blocos de silêncio',()=>{
 const {frameHasSpeech}=require('../src/audio-utils.js');assert.equal(frameHasSpeech(silence()),false);assert.equal(frameHasSpeech(speech()),true);
});
