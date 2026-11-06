const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildUrl,
  buildSetup,
  buildAudioMessage,
  parseServerMessage,
  createSession,
} = require("../src/gemini-translate.js");

class FakeWebSocket {
  static OPEN = 1;
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 0;
    FakeWebSocket.last = this;
  }
  send(text) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen();
  }
  receive(data) {
    return this.onmessage({ data });
  }
}

function openSession() {
  const events = [];
  const session = createSession({
    apiKey: "segredo",
    targetLanguageCode: "en",
    WebSocketImpl: FakeWebSocket,
    onEvent: (e) => events.push(e),
  });
  const ws = FakeWebSocket.last;
  ws.open();
  return { session, ws, events };
}

test("buildUrl usa o endpoint oficial e codifica a chave", () => {
  assert.equal(
    buildUrl("a b"),
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=a%20b"
  );
});

test("buildSetup segue a configuração do Live Translate", () => {
  assert.deepEqual(buildSetup("en"), {
    setup: {
      model: "models/gemini-3.5-live-translate-preview",
      generationConfig: {
        responseModalities: ["AUDIO"],
        translationConfig: { targetLanguageCode: "en", echoTargetLanguage: true },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  });
});

test("buildAudioMessage declara PCM de 16 kHz", () => {
  assert.deepEqual(buildAudioMessage("QUJD"), {
    realtimeInput: { audio: { data: "QUJD", mimeType: "audio/pcm;rate=16000" } },
  });
});

test("parseServerMessage extrai transcrições e todos os trechos de áudio", () => {
  const parsed = parseServerMessage(
    JSON.stringify({
      serverContent: {
        inputTranscription: { text: "olá" },
        outputTranscription: { text: "hello" },
        modelTurn: {
          parts: [{ inlineData: { data: "AAA" } }, { inlineData: { data: "BBB" } }],
        },
      },
    })
  );
  assert.equal(parsed.inputText, "olá");
  assert.equal(parsed.outputText, "hello");
  assert.deepEqual(parsed.audio, ["AAA", "BBB"]);
});

test("parseServerMessage reconhece setupComplete e goAway", () => {
  assert.equal(parseServerMessage('{"setupComplete":{}}').setupComplete, true);
  assert.equal(parseServerMessage('{"goAway":{"timeLeft":"5s"}}').goAway, true);
});

test("parseServerMessage não lança erro com JSON inválido", () => {
  const parsed = parseServerMessage("{quebrado");
  assert.equal(parsed.error, "invalid-json");
  assert.deepEqual(parsed.audio, []);
});

test("createSession envia o setup ao abrir", () => {
  const { ws } = openSession();
  assert.deepEqual(ws.sent[0], buildSetup("en"));
});

test("createSession descarta áudio enviado antes do setupComplete", () => {
  const { session, ws } = openSession();
  session.sendAudio("AAA");
  assert.equal(ws.sent.length, 1);
});

test("createSession pede mensagens binárias como ArrayBuffer", () => {
  const { ws } = openSession();
  assert.equal(ws.binaryType, "arraybuffer");
});

test("mensagens binárias são lidas na hora, preservando a ordem do áudio", () => {
  const { ws, events } = openSession();
  const encode = (data) =>
    new TextEncoder().encode(
      JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { data } }] } } })
    ).buffer;
  ws.receive(encode("A".repeat(100000)));
  ws.receive(encode("B"));
  assert.deepEqual(
    events.map((e) => e.data.length),
    [100000, 1]
  );
});

test("createSession avisa quando o servidor pede para trocar de conexão", () => {
  const { ws, events } = openSession();
  ws.receive('{"goAway":{"timeLeft":"5s"}}');
  assert.deepEqual(events, [{ type: "goAway" }]);
});

test("createSession emite os eventos na ordem recebida", () => {
  const { session, ws, events } = openSession();
  ws.receive('{"setupComplete":{}}');
  session.sendAudio("AAA");
  assert.deepEqual(ws.sent[1], buildAudioMessage("AAA"));
  ws.receive(
    JSON.stringify({
      serverContent: {
        inputTranscription: { text: "olá" },
        outputTranscription: { text: "hi" },
        modelTurn: { parts: [{ inlineData: { data: "BBB" } }] },
      },
    })
  );
  assert.deepEqual(events, [
    { type: "ready" },
    { type: "inputText", text: "olá" },
    { type: "outputText", text: "hi" },
    { type: "audio", data: "BBB", sampleRate: 24000 },
  ]);
});

test("createSession remove a chave do motivo de fechamento", () => {
  const { ws, events } = openSession();
  ws.onclose({ code: 1008, reason: "chave segredo inválida" });
  assert.deepEqual(events, [{ type: "closed", code: 1008, reason: "chave *** inválida" }]);
});

test('taxa PCM de saída acompanha cada trecho e usa 24 kHz quando omitida',()=>{
 const parsed=parseServerMessage(JSON.stringify({serverContent:{modelTurn:{parts:[{inlineData:{data:'A',mimeType:'audio/pcm;rate=48000'}},{inlineData:{data:'B'}}]}}}));
 assert.deepEqual(parsed.audioRates,[48000,24000]);
});
