// Roda no contexto da página. Nunca recebe a chave de API.
(function () {
  const SOURCE = "voz-traduzida";
  const OUTPUT_RATE = 24000;
  const {
    createResampler,
    frameHasSpeech,
    createChunker,
    int16ToBase64,
    base64ToFloat32,
    withVoiceProcessing,
  } = globalThis.VozAudio;

  const mediaDevices = navigator.mediaDevices;
  const realGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
  let mode = "original";
  // Cada captura vive até o Meet parar a própria faixa, porque ele pode continuar
  // transmitindo uma faixa antiga. Só a mais recente envia áudio para tradução.
  const pipelines = [];
  let lastPipeline = null;
  let lastMuted = false;
  let voiceFilters = true;
  let playbackProfile = "balanced";

  const up = (message) => window.postMessage({ source: SOURCE, dir: "up", ...message }, "*");

  function refreshMuted() {
    // Na dúvida sobre qual faixa está em uso, qualquer faixa muda bloqueia o envio.
    const muted = pipelines.some((p) => p.isDisabled());
    if (muted === lastMuted) return muted;
    lastMuted = muted;
    up({ type: "mic-muted", muted });
    if (muted) {
      for (const p of pipelines) {
        p.resetCapture();
        p.flush();
      }
    }
    return muted;
  }

  function createPipeline(realStream) {
    const realTrack = realStream.getAudioTracks()[0];
    const context = new AudioContext({ latencyHint: "interactive" });
    const micGain = context.createGain();
    const translatedGain = context.createGain();
    const silentSink = context.createGain();
    const destination = context.createMediaStreamDestination();
    // AudioWorklet carregado de arquivo pode ser bloqueado pela CSP do Meet.
    const processor = context.createScriptProcessor(1024, 1, 1);
    const micSource = context.createMediaStreamSource(new MediaStream([realTrack]));

    silentSink.gain.value = 0;
    micSource.connect(micGain).connect(destination);
    translatedGain.connect(destination);
    micSource.connect(processor).connect(silentSink).connect(context.destination);

    const track = destination.stream.getAudioTracks()[0];
    const player = globalThis.VozPlayback.createPcmPlayer(context, translatedGain, playbackProfile);
    let resampler = createResampler(context.sampleRate);
    let chunker = createChunker();
    let closed = false;

    function resetCapture() {
      chunker = createChunker();
      resampler = createResampler(context.sampleRate);
    }

    function flush() { player.flush(); }

    processor.onaudioprocess = (event) => {
      if (refreshMuted() || mode !== "translated" || pipelines.at(-1) !== self) return;
      const samples = resampler.push(event.inputBuffer.getChannelData(0));
      for (const block of chunker.push(samples)) {
        // Fluxo contínuo em blocos de 100 ms: o modelo faz a detecção de fala.
        up({ type: "audio", data: int16ToBase64(block), hasSpeech: frameHasSpeech(block) });
      }
    };

    function close() {
      if (closed) return;
      closed = true;
      flush();
      processor.onaudioprocess = null;
      realTrack.stop();
      clearInterval(playbackTimer);
      context.close();
      pipelines.splice(pipelines.indexOf(self), 1);
      if (pipelines.length === 0) up({ type: "mic-closed" });
    }

    const self = {
      close,
      flush,
      resetCapture,
      isDisabled: () => !track.enabled,
      // O Chrome pode ignorar a mudança em um microfone já aberto.
      async setVoiceFilters(on) {
        const constraints = { noiseSuppression: on, autoGainControl: false };
        await realTrack.applyConstraints(constraints).catch(() => {});
        return realTrack.getSettings().noiseSuppression === on;
      },
      setMode(next) {
        micGain.gain.value = next === "translated" ? 0 : 1;
        if (next !== "translated") {
          resetCapture();
          flush();
        }
        context.resume();
      },
      setPlaybackProfile(value) { player.setProfile(value); },
      play(b64, sampleRate = OUTPUT_RATE) {
        if (mode !== "translated" || lastMuted) return;
        player.play(base64ToFloat32(b64), sampleRate);
      },
      debug: {
        micGain: () => micGain.gain.value,
        queued: () => player.stats().queued,
        contextState: () => context.state,
      },
    };

    const playbackTimer = setInterval(() => {
      if (pipelines.at(-1) === self && mode === "translated") up({ type: "playback-state", ...player.stats() });
    }, 1000);

    // A faixa continua parecendo o microfone escolhido para o Meet.
    const stopOwnTrack = track.stop.bind(track);
    track.stop = () => {
      stopOwnTrack();
      close();
    };
    Object.defineProperty(track, "label", { get: () => realTrack.label });
    track.getSettings = () => realTrack.getSettings();
    track.getCapabilities = () => realTrack.getCapabilities();
    track.getConstraints = () => realTrack.getConstraints();
    track.applyConstraints = (constraints) => realTrack.applyConstraints(constraints);
    realTrack.addEventListener("ended", () => {
      close();
      track.dispatchEvent(new Event("ended"));
    });

    self.setMode(mode);
    return { self, track };
  }

  mediaDevices.getUserMedia = async function (constraints) {
    // A tradução recebe o microfone antes do filtro de ruído do próprio Meet.
    const realStream = await realGetUserMedia(withVoiceProcessing(constraints, voiceFilters));
    if (realStream.getAudioTracks().length === 0) return realStream;
    const { self, track } = createPipeline(realStream);
    pipelines.push(self);
    lastPipeline = self;
    up({ type: "mic-ready" });
    return new MediaStream([track, ...realStream.getVideoTracks()]);
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SOURCE || event.data.dir !== "down") return;
    const message = event.data;
    if (message.type === "set-mode") {
      mode = message.mode === "translated" ? "translated" : "original";
      for (const p of pipelines) p.setMode(mode);
    } else if (message.type === "play") {
      for (const p of pipelines) p.play(message.data, message.sampleRate);
    } else if (message.type === "playback-profile") {
      playbackProfile = ["fast", "balanced", "smooth"].includes(message.profile) ? message.profile : "balanced";
      for (const p of pipelines) p.setPlaybackProfile(playbackProfile);
    } else if (message.type === "flush") {
      for (const p of pipelines) p.flush();
    } else if (message.type === "voice-filters") {
      voiceFilters = message.on === true;
      if (pipelines.length > 0) {
        Promise.all(pipelines.map((p) => p.setVoiceFilters(voiceFilters))).then((results) => {
          up({ type: "voice-filters-state", applied: results.every(Boolean) });
        });
      }

    }
  });

  up({ type: "inject-ready" });

  if (window.__vozTest) {
    window.__vozDebug = {
      micGain: () => lastPipeline?.debug.micGain(),
      queued: () => lastPipeline?.debug.queued(),
      contextState: () => lastPipeline?.debug.contextState(),
      contextStates: () => pipelines.map((p) => p.debug.contextState()),
    };
  }
})();
