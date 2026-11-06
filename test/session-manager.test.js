const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionManager } = require("../src/session-manager.js");

const SETUP_MS = 10000;
const STALL_MS = 6000;
const STABLE_MS = 30000;
const DRAIN_MS = 5000;

function setup() {
  const sessions = [];
  const events = [];
  const timers = [];
  const manager = createSessionManager({
    createSession: (options) => {
      const session = { options, audio: [], closed: false };
      session.sendAudio = (b64) => session.audio.push(b64);
      session.close = () => {
        session.closed = true;
      };
      session.emit = (e) => options.onEvent(e);
      sessions.push(session);
      return session;
    },
    onEvent: (e) => events.push(e),
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel: (timer) => {
      timer.cancelled = true;
    },
  });
  const pending = (ms) => timers.filter((t) => t.ms === ms && !t.cancelled && !t.fired);
  const fire = (ms) => {
    const timer = pending(ms).at(-1);
    assert.ok(timer, `há um temporizador pendente de ${ms} ms`);
    timer.fired = true;
    timer.fn();
  };
  manager.start({ apiKey: "k", targetLanguageCode: "en" });
  return { manager, sessions, events, timers, pending, fire };
}

const closed = (code = 1006) => ({ type: "closed", code, reason: "queda" });
const types = (events) => events.map((e) => e.type);
const sendSpeech = (manager, frames) => {
  for (let i = 0; i < frames; i++) manager.sendAudio("AAA", true);
};

test("repassa os eventos e o áudio da sessão atual", () => {
  const { manager, sessions, events } = setup();
  sessions[0].emit({ type: "ready" });
  manager.sendAudio("AAA");
  assert.deepEqual(events, [{ type: "ready" }]);
  assert.deepEqual(sessions[0].audio, ["AAA"]);
});

test("reconecta após 1 s, 2 s e 4 s e depois desiste", () => {
  const { sessions, events, pending, fire } = setup();
  for (let i = 0; i < 3; i++) {
    sessions[i].emit(closed());
    fire([1000, 2000, 4000][i]);
  }
  assert.equal(sessions.length, 4);
  sessions[3].emit(closed());
  assert.equal(pending(8000).length, 0);
  assert.deepEqual(events.at(-1), { type: "failed", reason: "queda" });
  assert.deepEqual(
    events.filter((e) => e.type === "reconnecting").map((e) => e.attempt),
    [1, 2, 3]
  );
});

test("ready seguido de queda continua contando para o limite", () => {
  const { sessions, events, fire } = setup();
  for (let i = 0; i < 3; i++) {
    sessions[i].emit({ type: "ready" });
    sessions[i].emit(closed(1011));
    fire([1000, 2000, 4000][i]);
  }
  sessions[3].emit({ type: "ready" });
  sessions[3].emit(closed(1011));
  assert.equal(events.at(-1).type, "failed");
  assert.equal(sessions.length, 4);
});

test("uma sessão estável zera as tentativas", () => {
  const { sessions, pending, fire } = setup();
  sessions[0].emit(closed());
  fire(1000);
  sessions[1].emit({ type: "ready" });
  fire(STABLE_MS);
  sessions[1].emit(closed());
  assert.equal(pending(1000).length, 1);
});

for (const code of [1007, 1008]) {
  test(`fechamento ${code} falha sem tentar de novo`, () => {
    const { sessions, events, timers } = setup();
    sessions[0].emit(closed(code));
    assert.equal(timers.filter((t) => t.ms <= 8000 && !t.cancelled).length, 0);
    assert.equal(events.at(-1).type, "failed");
  });
}

test("sessão que nunca fica pronta é tratada como queda", () => {
  const { sessions, events, fire } = setup();
  fire(SETUP_MS);
  assert.equal(sessions[0].closed, true);
  assert.deepEqual(types(events), ["reconnecting"]);
});

test("áudio enviado sem nenhuma resposta derruba a sessão travada", () => {
  const { manager, sessions, events, fire } = setup();
  sessions[0].emit({ type: "ready" });
  sendSpeech(manager, 10);
  fire(STALL_MS);
  assert.equal(sessions[0].closed, true);
  assert.equal(events.at(-1).type, "reconnecting");
});

test("qualquer resposta do servidor cancela a detecção de travamento", () => {
  const { manager, sessions, pending } = setup();
  sessions[0].emit({ type: "ready" });
  sendSpeech(manager, 11);
  assert.equal(pending(STALL_MS).length, 1, "só um temporizador por vez");
  sessions[0].emit({ type: "inputText", text: "olá" });
  assert.equal(pending(STALL_MS).length, 0);
});

test("o silêncio depois de uma frase não conta como travamento", () => {
  const { manager, sessions, pending } = setup();
  sessions[0].emit({ type: "ready" });
  for (let i = 0; i < 100; i++) manager.sendAudio("AAA", false);
  assert.equal(pending(STALL_MS).length, 0);
});

test("um ruído curto sem resposta não conta como travamento", () => {
  const { manager, sessions, pending } = setup();
  sessions[0].emit({ type: "ready" });
  sendSpeech(manager, 9);
  assert.equal(pending(STALL_MS).length, 0);
});

test("uma resposta zera a contagem de fala sem resposta", () => {
  const { manager, sessions, pending } = setup();
  sessions[0].emit({ type: "ready" });
  sendSpeech(manager, 9);
  sessions[0].emit({ type: "inputText", text: "olá" });
  sendSpeech(manager, 9);
  assert.equal(pending(STALL_MS).length, 0);
});

test("eventos da sessão travada são ignorados depois da queda", () => {
  const { manager, sessions, events, fire } = setup();
  sessions[0].emit({ type: "ready" });
  sendSpeech(manager, 10);
  fire(STALL_MS);
  const count = events.length;
  sessions[0].emit({ type: "audio", data: "ZZZ" });
  sessions[0].emit(closed());
  assert.equal(events.length, count);
});

test("goAway abre outra sessão sem interromper a tradução", () => {
  const { manager, sessions, events, fire } = setup();
  sessions[0].emit({ type: "ready" });
  sessions[0].emit({ type: "goAway" });
  assert.equal(sessions.length, 2);
  manager.sendAudio("AAA");
  assert.deepEqual(sessions[0].audio, ["AAA"], "a sessão antiga segue até a nova ficar pronta");

  sessions[1].emit({ type: "ready" });
  manager.sendAudio("BBB");
  assert.deepEqual(sessions[1].audio, ["BBB"]);
  assert.deepEqual(types(events), ["ready"], "nada indica queda para o usuário");

  sessions[0].emit({ type: "audio", data: "FIM" });
  assert.deepEqual(events.at(-1), { type: "audio", data: "FIM" }, "a sessão antiga termina a frase");
  fire(DRAIN_MS);
  assert.equal(sessions[0].closed, true);
});

test("a sessão antiga fechar sozinha depois da troca não indica queda", () => {
  const { sessions, events } = setup();
  sessions[0].emit({ type: "ready" });
  sessions[0].emit({ type: "goAway" });
  sessions[1].emit({ type: "ready" });
  sessions[0].emit(closed());
  assert.deepEqual(types(events), ["ready"]);
});

test("queda antes da sessão nova ficar pronta usa a sessão já aberta", () => {
  const { sessions, events, timers } = setup();
  sessions[0].emit({ type: "ready" });
  sessions[0].emit({ type: "goAway" });
  sessions[0].emit(closed());
  assert.equal(events.at(-1).type, "reconnecting");
  assert.equal(sessions.length, 2);
  assert.equal(timers.filter((t) => t.ms === 1000).length, 0);
  sessions[1].emit({ type: "ready" });
  assert.equal(events.at(-1).type, "ready");
});

test("stop cancela uma reconexão pendente", () => {
  const { manager, sessions, pending } = setup();
  sessions[0].emit(closed());
  manager.stop();
  assert.equal(pending(1000).length, 0);
});

test("stop fecha todas as sessões e ignora os eventos delas", () => {
  const { manager, sessions, events } = setup();
  sessions[0].emit({ type: "ready" });
  sessions[0].emit({ type: "goAway" });
  const count = events.length;
  manager.stop();
  assert.equal(sessions[0].closed, true);
  assert.equal(sessions[1].closed, true);
  sessions[1].emit({ type: "ready" });
  sessions[0].emit(closed());
  assert.equal(events.length, count);
});

test("sendAudio sem sessão ativa não lança erro", () => {
  const { manager } = setup();
  manager.stop();
  assert.doesNotThrow(() => manager.sendAudio("AAA"));
});
