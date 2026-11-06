// Roda isolado da página: guarda a chave e mantém as conexões com o Gemini.
(function () {
  const SOURCE = "voz-traduzida";
  const MAX_CAPTION = 20000;
  const STICK_TO_BOTTOM_PX = 8;
  const ACTIVE = new Set(["connecting", "translating", "reconnecting"]);
  const REMOTE_ACTIVE = new Set([...ACTIVE, "selecting"]);
  let remoteGeneration = 0;
  const receiver = (message) => chrome.runtime.sendMessage({ type: "remote-control", ...message }).catch(() => {});
  const SIZES = [
    { id: "small", label: "Pequeno" },
    { id: "medium", label: "Médio" },
    { id: "large", label: "Grande" },
  ];

  const state = { connection: "off", muted: false, hasMic: false, reason: "" };
  const remoteState = { connection: "off", reason: "", voice: false, responses: 0, reconnects: 0 };
  const meter = globalThis.VozStatus.createLatencyMeter();
  const remoteMeter = globalThis.VozStatus.createLatencyMeter();
  let panelSize = "medium";
  let voiceFilters = true;
  let playbackProfile = "balanced";
  let filtersNeedReload = false;
  let ui = null;

  const down = (message) => window.postMessage({ source: SOURCE, dir: "down", ...message }, "*");
  const useOriginalVoice = () => {
    down({ type: "set-mode", mode: "original" });
    down({ type: "flush" });
  };

  const manager = globalThis.VozSessionManager.createSessionManager({
    createSession: globalThis.VozGemini.createSession,
    onEvent: handleSessionEvent,
  });
  const remoteManager = globalThis.VozSessionManager.createSessionManager({
    createSession: globalThis.VozGemini.createSession,
    onEvent: handleRemoteEvent,
  });

  function setConnection(connection, reason = "") {
    state.connection = connection;
    state.reason = reason;
    render();
  }

  function setRemoteConnection(connection, reason = "") {
    remoteState.connection = connection;
    remoteState.reason = reason;
    render();
  }

  function handleSessionEvent(event) {
    if (event.type === "ready") {
      down({ type: "set-mode", mode: "translated" });
      setConnection("translating");
    } else if (event.type === "inputText") {
      appendCaption("input", event.text);
    } else if (event.type === "outputText") {
      appendCaption("output", event.text);
      showLatency("latency", meter);
    } else if (event.type === "audio") {
      down({ type: "play", data: event.data, sampleRate: event.sampleRate });
      showLatency("latency", meter);
    } else if (event.type === "reconnecting") {
      useOriginalVoice();
      setConnection("reconnecting");
    } else if (event.type === "failed") {
      useOriginalVoice();
      if (ui) ui.playbackDiag.textContent = "";
      setConnection("failed", event.reason);
    }
  }

  function handleRemoteEvent(event) {
    if (["inputText", "outputText", "audio"].includes(event.type)) remoteState.responses++;
    if (event.type === "reconnecting") remoteState.reconnects++;
    if (event.type === "ready") {
      setRemoteConnection("translating");
    } else if (event.type === "inputText") {
      appendCaption("remoteInput", event.text);
      render();
    } else if (event.type === "outputText") {
      appendCaption("remoteOutput", event.text);
      showLatency("remoteLatency", remoteMeter);
      render();
    } else if (event.type === "audio") {
      showLatency("remoteLatency", remoteMeter);
      render();
      if (remoteState.voice) receiver({ command: "play", data: event.data, sampleRate: event.sampleRate });
    } else if (event.type === "reconnecting") {
      setRemoteConnection("reconnecting");
    } else if (event.type === "failed") {
      receiver({ command: "stop" });
      setRemoteConnection("failed", event.reason);
    }
  }

  async function start() {
    const { apiKey, targetLanguage } = await chrome.storage.local.get(["apiKey", "targetLanguage"]);
    if (!apiKey) {
      setConnection("no-key");
      return;
    }
    setConnection("connecting");
    manager.start({ apiKey, targetLanguageCode: targetLanguage || "en" });
  }

  function stop() {
    manager.stop();
    useOriginalVoice();
    if (ui) ui.playbackDiag.textContent = "";
    setConnection("off");
  }

  async function startRemote() {
    const attempt = ++remoteGeneration;
    const { apiKey } = await chrome.storage.local.get(["apiKey"]);
    if (attempt !== remoteGeneration) return;
    if (!apiKey) { setRemoteConnection("no-key"); return; }
    remoteState.tracks = undefined;
    remoteState.hearing = false;
    remoteState.peak = undefined;
    remoteState.responses = 0;
    remoteState.reconnects = 0;
    remoteState.silentSeconds = 0;
    remoteState.weakSeconds = 0;
    remoteState.sourceLabel = "";
    setRemoteConnection("selecting");
    try {
      const result = await chrome.runtime.sendMessage({type:"remote-open",voice:remoteState.voice,profile:playbackProfile});
      if (attempt === remoteGeneration && !result?.ok) setRemoteConnection("failed", result?.reason || "Não foi possível abrir a captura. Recarregue a extensão e o Meet.");
    } catch (error) { if (attempt === remoteGeneration) setRemoteConnection("failed", error.message); }
  }

  function stopRemote(notify = true) {
    remoteGeneration++;
    remoteManager.stop();
    if (notify) receiver({command:"stop"});
    setRemoteConnection("off");
  }

  function setRemoteVoice(on) {
    remoteState.voice = on;
    receiver({command:"voice",voice:on});
    render();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "remote-window-event") return;
    const event = message.event;
    if (event.type === "remote-ready") {
      const attempt = ++remoteGeneration;
      setRemoteConnection("connecting");
      chrome.storage.local.get(["apiKey","myLanguage"]).then(stored => {
        if (attempt !== remoteGeneration) return;
        if (!stored.apiKey) { receiver({command:"stop"});setRemoteConnection("no-key");return; }
        remoteManager.start({apiKey:stored.apiKey,targetLanguageCode:stored.myLanguage||"pt-BR"});
      });
    } else if (event.type === "remote-audio") {
      if (ACTIVE.has(remoteState.connection)) {
        if (event.hasSpeech) remoteMeter.speech();
        remoteManager.sendAudio(event.data,event.hasSpeech);
      }
    } else if (event.type === "remote-state") {
      Object.assign(remoteState,event); render();
    } else if (event.type === "remote-ended") {
      remoteGeneration++; remoteManager.stop();
      if (!["failed","no-key"].includes(remoteState.connection)) setRemoteConnection("off");
    }
    else if (event.type === "remote-error") { stopRemote(false);setRemoteConnection("failed",event.reason); }
    else if (event.type === "remote-voice-state") {remoteState.voice=event.voice;render();}
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SOURCE || event.data.dir !== "up") return;
    const message = event.data;
    if (message.type === "audio") {
      if (ACTIVE.has(state.connection)) {
        if (message.hasSpeech) meter.speech();
        manager.sendAudio(message.data, message.hasSpeech);
      }
    } else if (message.type === "inject-ready") {
      down({ type: "voice-filters", on: voiceFilters });
      down({ type: "playback-profile", profile: playbackProfile });
      receiver({command:"profile",profile:playbackProfile});
    } else if (message.type === "voice-filters-state") {
      filtersNeedReload = !message.applied;
      render();
    } else if (message.type === "playback-state") {
      if (ui) ui.playbackDiag.textContent = `Fila local: ${Math.round(message.bufferedMs)} ms · Interrupções: ${message.underruns}`;
    } else if (message.type === "mic-muted") {
      state.muted = message.muted;
      render();
    } else if (message.type === "mic-ready") {
      state.hasMic = true;
      render();
    } else if (message.type === "mic-closed") {
      state.hasMic = false;
      render();
    }
  });

  function appendCaption(kind, text) {
    if (!ui) return;
    const element = ui[kind];
    // Só acompanha o texto novo se a pessoa não subiu para reler.
    const atBottom =
      element.scrollTop + element.clientHeight >= element.scrollHeight - STICK_TO_BOTTOM_PX;
    element.textContent = (element.textContent + text).slice(-MAX_CAPTION);
    if (atBottom) element.scrollTop = element.scrollHeight;
  }

  function showLatency(kind, latencyMeter) {
    const latency = latencyMeter.output();
    if (ui && latency !== null) ui[kind].textContent = globalThis.VozStatus.latencyText(latency);
  }

  function applyPanelSize(id) {
    const size = SIZES.find((candidate) => candidate.id === id);
    if (!size) return;
    panelSize = id;
    ui.panel.dataset.size = id;
    ui.size.textContent = `Tamanho: ${size.label}`;
  }

  function cyclePanelSize() {
    const index = SIZES.findIndex((size) => size.id === panelSize);
    const next = SIZES[(index + 1) % SIZES.length].id;
    applyPanelSize(next);
    chrome.storage.local.set({ panelSize: next });
  }

  function setVoiceFilters(on) {
    voiceFilters = on;
    filtersNeedReload = false;
    down({ type: "voice-filters", on });
    render();
  }

  function clearCaptions() {
    for (const kind of ["input", "output", "remoteInput", "remoteOutput"]) {
      ui[kind].textContent = "";
    }
  }

  function render() {
    if (!ui) return;
    const { statusText, remoteStatusText } = globalThis.VozStatus;

    const mine = statusText(state);
    ui.status.textContent = mine.text;
    ui.status.classList.toggle("error", mine.isError);
    const active = ACTIVE.has(state.connection);
    ui.toggle.textContent = active ? "Voltar à voz normal" : "Traduzir minha voz";
    ui.toggle.classList.toggle("on", active);

    ui.filters.textContent = `Filtros de ruído: ${voiceFilters ? "ligados" : "desligados"}`;
    ui.filters.setAttribute("aria-pressed", String(voiceFilters));
    ui.filtersHint.textContent = filtersNeedReload ? "Recarregue a reunião para aplicar a mudança." : "";

    const theirs = remoteStatusText(remoteState);
    ui.remoteStatus.textContent = theirs.text;
    ui.remoteStatus.classList.toggle("error", theirs.isError);
    ui.remoteDiag.textContent = globalThis.VozStatus.remoteDiagnosticText(remoteState);
    const remoteActive = REMOTE_ACTIVE.has(remoteState.connection);
    ui.remoteToggle.textContent = remoteActive
      ? "Parar de traduzir a outra pessoa"
      : "Traduzir a outra pessoa";
    ui.remoteToggle.classList.toggle("on", remoteActive);

    ui.modeText.setAttribute("aria-pressed", String(!remoteState.voice));
    ui.modeVoice.setAttribute("aria-pressed", String(remoteState.voice));
    ui.remoteHint.textContent = remoteState.voice
      ? "Use fones: sem eles, o microfone pode captar a tradução."
      : "";
  }

  function createPanel() {
    const host = document.createElement("div");
    const root = host.attachShadow({ mode: "closed" });
    globalThis.VozPanelDom.appendPanel(root);
    ui = {
      panel: root.querySelector(".panel"),
      playbackProfile: root.querySelector(".playback-profile"),
      playbackDiag: root.querySelector(".playback-diag"),
      size: root.querySelector(".size"),
      toggle: root.querySelector(".toggle"),
      status: root.querySelector(".status"),
      latency: root.querySelector(".my-latency"),
      remoteLatency: root.querySelector(".remote-latency"),
      remoteDiag: root.querySelector(".remote-diag"),
      input: root.querySelector(".input"),
      output: root.querySelector(".output"),
      remoteToggle: root.querySelector(".remote-toggle"),
      remoteStatus: root.querySelector(".remote-status"),
      remoteHint: root.querySelector(".remote-hint"),
      remoteInput: root.querySelector(".remote-input"),
      remoteOutput: root.querySelector(".remote-output"),
      filters: root.querySelector(".filters"),
      filtersHint: root.querySelector(".filters-hint"),
      modeText: root.querySelector(".mode-text"),
      modeVoice: root.querySelector(".mode-voice"),
    };
    ui.toggle.addEventListener("click", () => (ACTIVE.has(state.connection) ? stop() : start()));
    ui.remoteToggle.addEventListener("click", () =>
      REMOTE_ACTIVE.has(remoteState.connection) ? stopRemote() : startRemote()
    );
    ui.modeText.addEventListener("click", () => setRemoteVoice(false));
    ui.modeVoice.addEventListener("click", () => setRemoteVoice(true));
    root.querySelector(".clear").addEventListener("click", clearCaptions);
    ui.size.addEventListener("click", cyclePanelSize);
    ui.filters.addEventListener("click", () => {
      setVoiceFilters(!voiceFilters);
      chrome.storage.local.set({ voiceFilters });
    });
    ui.playbackProfile.addEventListener("change", () => {
      playbackProfile = ui.playbackProfile.value;
      down({ type: "playback-profile", profile: playbackProfile });
      receiver({command:"profile",profile:playbackProfile});
      chrome.storage.local.set({ playbackProfile });
    });
    applyPanelSize(panelSize);
    chrome.storage.local.get(["panelSize", "voiceFilters", "playbackProfile"]).then((stored) => {
      applyPanelSize(stored.panelSize);
      setVoiceFilters(stored.voiceFilters ?? true);
      playbackProfile = ["fast", "balanced", "smooth"].includes(stored.playbackProfile) ? stored.playbackProfile : "balanced";
      ui.playbackProfile.value = playbackProfile;
      down({ type: "playback-profile", profile: playbackProfile });
      receiver({command:"profile",profile:playbackProfile});
    });
    render();
    const mount = () => {
      const target = document.fullscreenElement || document.documentElement;
      if (target && host.parentNode !== target) target.appendChild(host);
    };
    mount();
    document.addEventListener("fullscreenchange", mount);
    window.addEventListener("pageshow", mount);
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(mount).observe(document.documentElement, {childList:true, subtree:true});
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createPanel, { once: true });
  } else {
    createPanel();
  }
})();
