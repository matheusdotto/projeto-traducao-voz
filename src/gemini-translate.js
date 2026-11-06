// Único arquivo que conhece o formato da API de tradução do Gemini.
(function () {
  const ENDPOINT =
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  const MODEL = "models/gemini-3.5-live-translate-preview";

  function buildUrl(apiKey) {
    return `${ENDPOINT}?key=${encodeURIComponent(apiKey)}`;
  }

  function buildSetup(targetLanguageCode) {
    return {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"],
          // Com false, frases já no idioma de destino não chegariam a ninguém.
          translationConfig: { targetLanguageCode, echoTargetLanguage: true },
        },
        // O servidor só aceita as transcrições aqui, embora o exemplo em WebSocket
        // da documentação as coloque em generationConfig.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };
  }

  function buildAudioMessage(b64) {
    return { realtimeInput: { audio: { data: b64, mimeType: "audio/pcm;rate=16000" } } };
  }

  function parseServerMessage(text) {
    const parsed = {
      setupComplete: false,
      inputText: undefined,
      outputText: undefined,
      audio: [],
      audioRates: [],
      goAway: false,
      error: undefined,
    };
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      parsed.error = "invalid-json";
      return parsed;
    }
    parsed.setupComplete = Boolean(message.setupComplete);
    parsed.goAway = Boolean(message.goAway);
    const content = message.serverContent;
    if (content) {
      parsed.inputText = content.inputTranscription?.text;
      parsed.outputText = content.outputTranscription?.text;
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          parsed.audio.push(part.inlineData.data);
          const match = /(?:^|;)\s*rate=(\d+)/i.exec(part.inlineData.mimeType || "");
          parsed.audioRates.push(match ? Number(match[1]) : 24000);
        }
      }
    }
    return parsed;
  }

  function createSession({ apiKey, targetLanguageCode, WebSocketImpl = WebSocket, onEvent }) {
    const socket = new WebSocketImpl(buildUrl(apiKey));
    const decoder = new TextDecoder();
    let ready = false;

    // Decodificar na hora mantém o áudio na ordem em que chegou.
    socket.binaryType = "arraybuffer";

    socket.onopen = () => socket.send(JSON.stringify(buildSetup(targetLanguageCode)));

    socket.onmessage = (event) => {
      const text = typeof event.data === "string" ? event.data : decoder.decode(event.data);
      const parsed = parseServerMessage(text);
      if (parsed.setupComplete) {
        ready = true;
        onEvent({ type: "ready" });
      }
      if (parsed.goAway) onEvent({ type: "goAway" });
      if (parsed.inputText) onEvent({ type: "inputText", text: parsed.inputText });
      if (parsed.outputText) onEvent({ type: "outputText", text: parsed.outputText });
      parsed.audio.forEach((data, index) => onEvent({ type: "audio", data, sampleRate: parsed.audioRates[index] }));
    };

    socket.onclose = (event) => {
      ready = false;
      const reason = String(event.reason ?? "").split(apiKey).join("***");
      onEvent({ type: "closed", code: event.code, reason });
    };

    return {
      sendAudio: (b64) => {
        if (ready) socket.send(JSON.stringify(buildAudioMessage(b64)));
      },
      close: () => socket.close(),
    };
  }

  const api = {
    buildUrl,
    buildSetup,
    buildAudioMessage,
    parseServerMessage,
    createSession,
  };
  globalThis.VozGemini = api;
  if (typeof module !== "undefined") module.exports = api;
})();
