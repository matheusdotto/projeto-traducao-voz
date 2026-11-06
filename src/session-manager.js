(function () {
  // Fechamentos que não melhoram com nova tentativa, como chave inválida.
  const FATAL_CODES = new Set([1007, 1008]);
  const DRAIN_MS = 5000;
  // Ruídos curtos podem não gerar resposta; só cerca de 1 s de fala conta como travamento.
  const STALL_MIN_SPEECH_FRAMES = 10;

  function createSessionManager({
    createSession,
    onEvent,
    schedule = setTimeout,
    cancel = clearTimeout,
    maxRetries = 3,
    setupTimeoutMs = 10000,
    stallTimeoutMs = 6000,
    stableAfterMs = 30000,
  }) {
    let current = null;
    let standby = null;
    let draining = new Set();
    let retryTimer = null;
    let options = null;
    let attempts = 0;

    function setTimer(entry, name, ms, fn) {
      entry.timers[name] = schedule(fn, ms);
    }

    function clearTimer(entry, name) {
      if (entry.timers[name] === undefined) return;
      cancel(entry.timers[name]);
      delete entry.timers[name];
    }

    function open(role) {
      const entry = { role, timers: {}, ready: false, dead: false, unanswered: 0 };
      entry.session = createSession({ ...options, onEvent: (e) => handle(entry, e) });
      return entry;
    }

    function kill(entry) {
      entry.dead = true;
      for (const name of Object.keys(entry.timers)) clearTimer(entry, name);
      entry.session.close();
    }

    function armSetupTimeout(entry) {
      setTimer(entry, "setup", setupTimeoutMs, () => lost(entry, 0, "A conexão não respondeu."));
    }

    function connect() {
      retryTimer = null;
      current = open("current");
      armSetupTimeout(current);
    }

    function lost(entry, code, reason) {
      kill(entry);
      current = null;
      if (FATAL_CODES.has(code) || attempts >= maxRetries) {
        if (standby) kill(standby);
        standby = null;
        onEvent({ type: "failed", reason });
        return;
      }
      attempts++;
      onEvent({ type: "reconnecting", attempt: attempts });
      if (standby) {
        current = standby;
        current.role = "current";
        standby = null;
        armSetupTimeout(current);
        return;
      }
      retryTimer = schedule(connect, 1000 * 2 ** (attempts - 1));
    }

    function armStable(entry) {
      setTimer(entry, "stable", stableAfterMs, () => {
        delete entry.timers.stable;
        attempts = 0;
      });
    }

    function promoteStandby(entry) {
      const old = current;
      old.role = "draining";
      clearTimer(old, "stall");
      clearTimer(old, "stable");
      draining.add(old);
      setTimer(old, "drain", DRAIN_MS, () => {
        delete old.timers.drain;
        draining.delete(old);
        kill(old);
      });
      entry.role = "current";
      entry.ready = true;
      standby = null;
      current = entry;
      armStable(entry);
    }

    function handle(entry, event) {
      if (entry.dead) return;
      if (entry.role === "standby") {
        if (event.type === "ready") {
          promoteStandby(entry);
        } else if (event.type === "closed") {
          entry.dead = true;
          standby = null;
        }
        return;
      }
      if (entry.role === "draining") {
        if (event.type === "closed") {
          draining.delete(entry);
          kill(entry);
        } else if (["audio", "inputText", "outputText"].includes(event.type)) {
          onEvent(event);
        }
        return;
      }
      clearTimer(entry, "stall");
      entry.unanswered = 0;
      if (event.type === "closed") {
        lost(entry, event.code, event.reason);
      } else if (event.type === "goAway") {
        if (!standby) standby = open("standby");
      } else {
        if (event.type === "ready") {
          entry.ready = true;
          clearTimer(entry, "setup");
          armStable(entry);
        }
        onEvent(event);
      }
    }

    return {
      start(startOptions) {
        this.stop();
        options = startOptions;
        attempts = 0;
        connect();
      },
      stop() {
        if (retryTimer !== null) cancel(retryTimer);
        retryTimer = null;
        for (const entry of [current, standby, ...draining]) {
          if (entry) kill(entry);
        }
        current = null;
        standby = null;
        draining = new Set();
      },
      sendAudio(b64, hasSpeech = false) {
        if (!current) return;
        current.session.sendAudio(b64);
        const entry = current;
        if (hasSpeech) entry.unanswered++;
        if (
          entry.ready &&
          entry.unanswered >= STALL_MIN_SPEECH_FRAMES &&
          entry.timers.stall === undefined
        ) {
          setTimer(entry, "stall", stallTimeoutMs, () =>
            lost(entry, 0, "A tradução parou de responder.")
          );
        }
      },
    };
  }

  const api = { createSessionManager };
  globalThis.VozSessionManager = api;
  if (typeof module !== "undefined") module.exports = api;
})();
