const test = require("node:test");
const assert = require("node:assert/strict");
const { statusText, remoteStatusText, createLatencyMeter, latencyText, remoteDiagnosticText } = require("../src/status.js");

const base = { connection: "translating", muted: false, hasMic: true };

test("só diz que está traduzindo com conexão e microfone ativos", () => {
  assert.equal(statusText(base).text, "Traduzindo a sua voz.");
});

test("mudo tem prioridade sobre traduzindo", () => {
  assert.equal(statusText({ ...base, muted: true }).text, "Microfone mudo: nada está sendo traduzido.");
});

test("sem microfone não afirma que está traduzindo", () => {
  assert.equal(statusText({ ...base, hasMic: false }).text, "Aguardando o microfone da reunião.");
});

test("durante a reconexão continua avisando da voz normal, mesmo ao alternar o mudo", () => {
  for (const muted of [true, false]) {
    assert.match(statusText({ ...base, connection: "reconnecting", muted }).text, /voz normal voltou/);
  }
});

test("durante a conexão inicial avisa que a voz normal continua", () => {
  assert.match(statusText({ ...base, connection: "connecting", muted: true }).text, /voz normal continua/);
});

test("desligado informa a voz normal", () => {
  assert.equal(statusText({ ...base, connection: "off" }).text, "Sua voz normal está ativa.");
});

test("falha aparece como erro e inclui o motivo", () => {
  const status = statusText({ ...base, connection: "failed", reason: "Cota esgotada." });
  assert.equal(status.isError, true);
  assert.match(status.text, /voz normal voltou\. Cota esgotada\./);
});

test("falha sem motivo sugere conferir a chave e a conexão", () => {
  assert.match(statusText({ ...base, connection: "failed" }).text, /Verifique a chave e a conexão/);
});

test("falta de chave aparece como erro", () => {
  assert.equal(statusText({ ...base, connection: "no-key" }).isError, true);
});

test("a tradução da outra pessoa informa cada estado", () => {
  assert.equal(remoteStatusText({ connection: "off" }).text, "Desligada.");
  assert.match(remoteStatusText({ connection: "connecting" }).text, /Conectando/);
  assert.match(
    remoteStatusText({ connection: "translating", tracks: 2, hearing: true }).text,
    /Traduzindo/
  );
  assert.match(remoteStatusText({ connection: "reconnecting" }).text, /Reconectando/);
});

test("uma falha na tradução da outra pessoa aparece como erro, com o motivo", () => {
  const status = remoteStatusText({ connection: "failed", reason: "Cota esgotada." });
  assert.equal(status.isError, true);
  assert.match(status.text, /Cota esgotada\./);
});

test("falta de chave na tradução da outra pessoa aparece como erro", () => {
  assert.equal(remoteStatusText({ connection: "no-key" }).isError, true);
});

test("sem áudio da chamada, a caixa da outra pessoa avisa em vez de dizer que traduz", () => {
  const status = remoteStatusText({ connection: "translating", tracks: 0, hearing: false });
  assert.match(status.text, /Nenhum áudio da chamada/);
  assert.equal(status.isError, true);
});

test("com áudio mas sem som, a caixa da outra pessoa aguarda alguém falar", () => {
  const status = remoteStatusText({ connection: "translating", tracks: 3, hearing: false });
  assert.match(status.text, /Aguardando alguém falar/);
  assert.match(status.text, /3/);
  assert.equal(status.isError, false);
});

test("antes do primeiro relatório, a caixa da outra pessoa não afirma que traduz", () => {
  assert.match(remoteStatusText({ connection: "translating" }).text, /Procurando/);
});

function meterAt(times) {
  return createLatencyMeter(() => times.shift());
}

test("o atraso conta do início da fala até a primeira tradução", () => {
  const meter = meterAt([1000, 3400]);
  meter.speech();
  meter.speech();
  assert.equal(meter.output(), 2400);
});

test("traduções seguidas da mesma fala não medem de novo", () => {
  const meter = meterAt([1000, 3400]);
  meter.speech();
  meter.output();
  assert.equal(meter.output(), null);
});

test("uma tradução sem fala pendente não gera medida", () => {
  assert.equal(meterAt([]).output(), null);
});

test("a fala depois de uma tradução começa uma nova medida", () => {
  const meter = meterAt([1000, 2000, 5000, 5500]);
  meter.speech();
  meter.output();
  meter.speech();
  assert.equal(meter.output(), 500);
});

test("latencyText mostra os segundos com uma casa decimal", () => {
  assert.equal(latencyText(2400), "Atraso da última tradução: 2,4 s");
  assert.equal(latencyText(null), "");
});

test("o diagnóstico mostra som, envio, respostas e reconexões", () => {
  assert.equal(
    remoteDiagnosticText({
      peak: 0.5,
      sentFrames: 120,
      responses: 3,
      reconnects: 1,
      contextState: "running",
    }),
    "Pico de som: 0,5000 · Enviado: 12 s · Respostas: 3 · Reconexões: 1 · Áudio: running"
  );
});

test("o diagnóstico fica vazio antes do primeiro relatório", () => {
  assert.equal(remoteDiagnosticText({ responses: 0, reconnects: 0 }), "");
});


test('diagnóstico informa sinal fraco sem afirmar que há voz',()=>{
 const result=remoteStatusText({connection:'translating',tracks:1,weakSeconds:10});
 assert.match(result.text,/Sinal muito baixo ou pausa/);assert.equal(result.isError,false);
 const text=remoteDiagnosticText({peak:.0003,sentFrames:10,responses:0,reconnects:0,contextState:'running',signalDb:-70,sourceLabel:'Teams | reunião',mutedTracks:0});
 assert.match(text,/-70.0 dBFS/);assert.match(text,/Teams \| reunião/);assert.match(text,/Faixas sem mídia: 0/);
});
