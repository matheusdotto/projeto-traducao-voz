(function () {
  function statusText({ connection, muted, hasMic, reason }) {
    switch (connection) {
      case "no-key":
        return { text: "Cole a sua chave no ícone da extensão, na barra do Chrome.", isError: true };
      case "failed":
        return {
          text: `A tradução parou e sua voz normal voltou. ${reason || "Verifique a chave e a conexão."}`,
          isError: true,
        };
      case "connecting":
        return { text: "Conectando. Sua voz normal continua até a tradução começar.", isError: false };
      case "reconnecting":
        return { text: "Conexão perdida: sua voz normal voltou enquanto reconecto.", isError: false };
      case "translating":
        if (muted) return { text: "Microfone mudo: nada está sendo traduzido.", isError: false };
        if (!hasMic) return { text: "Aguardando o microfone da reunião.", isError: false };
        return { text: "Traduzindo a sua voz.", isError: false };
      default:
        return { text: "Sua voz normal está ativa.", isError: false };
    }
  }

  function remoteStatusText({ connection, reason, tracks, hearing, silentSeconds, weakSeconds }) {
    switch (connection) {
      case "no-key":
        return { text: "Cole a sua chave no ícone da extensão, na barra do Chrome.", isError: true };
      case "failed":
        return {
          text: `A tradução parou. ${reason || "Verifique a chave e a conexão."}`,
          isError: true,
        };
      case "selecting":
        return {text:"Na janela de captura, clique em Selecionar aba com áudio e escolha a aba da reunião (Meet/Teams).",isError:false};
      case "connecting":
        return { text: "Conectando.", isError: false };
      case "reconnecting":
        return { text: "Conexão perdida. Reconectando.", isError: false };
      case "translating":
        if (tracks === undefined) return { text: "Procurando o áudio da chamada.", isError: false };
        if (tracks === 0) {
          return { text: "Nenhum áudio da chamada foi encontrado.", isError: true };
        }
        if (silentSeconds >= 10) return {text:"Sem som há 10 s ou mais. Se alguém está falando, confira a aba escolhida.",isError:true};
        if (weakSeconds >= 10) return {text:"Sinal muito baixo ou pausa. Se a pessoa fala, confira a aba capturada e a saída de áudio da reunião.",isError:false};
        if (!hearing) {
          return { text: `Aguardando alguém falar (${tracks} áudios da chamada).`, isError: false };
        }
        return { text: "Traduzindo o que os outros falam.", isError: false };
      default:
        return { text: "Desligada.", isError: false };
    }
  }

  // Mede do início da fala até a primeira tradução, o tempo que a pessoa sente.
  function createLatencyMeter(now = Date.now) {
    let speechStartedAt = null;
    return {
      speech() {
        if (speechStartedAt === null) speechStartedAt = now();
      },
      output() {
        if (speechStartedAt === null) return null;
        const latency = now() - speechStartedAt;
        speechStartedAt = null;
        return latency;
      },
    };
  }

  function latencyText(ms) {
    if (ms === null) return "";
    return `Atraso da última tradução: ${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  }

  function remoteDiagnosticText({ peak, sentFrames, responses, reconnects, contextState, captureMode, signalDb, sourceLabel, mutedTracks }) {
    if (peak === undefined) return "";
    const decimal = (value, digits) => value.toFixed(digits).replace(".", ",");
    return [
      `Pico de som: ${decimal(peak, 4)}`,
      `Enviado: ${Math.round(sentFrames / 10)} s`,
      `Respostas: ${responses}`,
      `Reconexões: ${reconnects}`,
      `Áudio: ${contextState}`,
      ...(captureMode === "tab" ? ["Fonte: áudio da aba"] : []),
      ...(signalDb !== undefined ? [`Nível: ${signalDb === null ? "silêncio" : signalDb.toFixed(1)+" dBFS"}`] : []),
      ...(sourceLabel ? [`Capturando: ${sourceLabel}`] : []),
      ...(mutedTracks !== undefined ? [`Faixas sem mídia: ${mutedTracks}`] : []),
    ].join(" · ");
  }

  const api = {
    statusText,
    remoteStatusText,
    createLatencyMeter,
    latencyText,
    remoteDiagnosticText,
  };
  globalThis.VozStatus = api;
  if (typeof module !== "undefined") module.exports = api;
})();
