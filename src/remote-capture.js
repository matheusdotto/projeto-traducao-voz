// Captura a saída da aba escolhida. Vive em outra página para não recapturar a tradução.
(function () {
  function createRemoteCapture({ onEvent, mediaDevices = navigator.mediaDevices,
    AudioContextImpl = AudioContext, StreamImpl = MediaStream,
    audio = globalThis.VozAudio, playback = globalThis.VozPlayback,
    schedule = setInterval, cancel = clearInterval }) {
    let current = null, generation = 0, voice = false, profile = 'balanced';
    const release = stream => stream.getTracks().forEach(t => t.stop());
    function stop() {
      generation++;
      const entry = current; current = null;
      if (!entry) return;
      cancel(entry.timer); if(entry.processor) entry.processor.onaudioprocess = null;
      entry.player?.flush(); entry.source?.disconnect();
      release(entry.stream); entry.context.close().catch(() => {});
    }
    function setVoice(value) {
      voice = value === true;
      if (!current) return;
      current.monitor.gain.value = voice ? 0.25 : 1;
      if (!voice) current.player.flush();
    }
    async function start() {
      stop(); const token = generation; let stream;
      try {
        // Chamada direta no clique; autorização é solicitada em cada início.
        stream = await mediaDevices.getDisplayMedia({video: true,
          audio: {suppressLocalAudioPlayback: true}, preferCurrentTab: false,
          selfBrowserSurface: 'exclude', systemAudio: 'exclude', surfaceSwitching: 'exclude'});
        if (token !== generation) { release(stream); return false; }
        const tracks = stream.getAudioTracks();
        if (!tracks.length) throw Error('Selecione a aba da reunião (Meet/Teams) e marque Compartilhar áudio da aba. A seleção veio sem áudio.');
        const surface = stream.getVideoTracks()[0]?.getSettings?.().displaySurface;
        if (surface && surface !== 'browser') throw Error('Escolha uma aba do navegador, em vez da tela inteira ou de uma janela.');
        const context = new AudioContextImpl({latencyHint: 'interactive'});
        const entry = current = {stream, context, peak:0, sentFrames:0, heard:false, silentSeconds:0, weakSeconds:0, sumSquares:0, sampleCount:0};
        entry.source = context.createMediaStreamSource(new StreamImpl(tracks));
        entry.processor = context.createScriptProcessor(1024,1,1);
        entry.sink = context.createGain(); entry.sink.gain.value = 0;
        entry.monitor = context.createGain();
        // Se o navegador silenciou a saída local, a restauramos na página auxiliar.
        // Essa página não é a aba capturada, portanto o monitor e a tradução ficam fora da entrada.
        entry.suppressed = tracks.some(t => t.getSettings?.().suppressLocalAudioPlayback === true);
        if (entry.suppressed) entry.source.connect(entry.monitor).connect(context.destination);
        entry.player = playback.createPcmPlayer(context, context.destination, profile);
        entry.source.connect(entry.processor).connect(entry.sink).connect(context.destination);
        const resampler = audio.createResampler(context.sampleRate), chunker = audio.createChunker();
        entry.processor.onaudioprocess = event => {
          if (current !== entry) return;
          const input = event.inputBuffer.getChannelData(0);
          for (const sample of input) { entry.peak = Math.max(entry.peak, Math.abs(sample)); entry.sumSquares += sample*sample; entry.sampleCount++; }
          for (const frame of chunker.push(resampler.push(input))) {
            const hasSpeech = audio.frameHasSpeech(frame);
            entry.heard ||= hasSpeech; entry.sentFrames++;
            onEvent({type:'remote-audio', data:audio.int16ToBase64(frame), hasSpeech});
          }
        };
        const ended = () => { if (current === entry) { stop(); onEvent({type:'remote-ended'}); } };
        stream.getTracks().forEach(t => t.addEventListener('ended', ended, {once:true}));
        const report = () => {
          if (current !== entry) return;
          entry.silentSeconds = entry.peak < .0001 ? entry.silentSeconds+1 : 0;
          entry.weakSeconds = entry.peak < .003 ? entry.weakSeconds+1 : 0;
          const rms = Math.sqrt(entry.sumSquares / Math.max(1,entry.sampleCount));
          onEvent({type:'remote-state',tracks:tracks.length,hearing:entry.heard,peak:entry.peak,
            sentFrames:entry.sentFrames,contextState:context.state,silentSeconds:entry.silentSeconds,
            weakSeconds:entry.weakSeconds,signalDb:rms>0?20*Math.log10(rms):null,
            sourceLabel:String(stream.getVideoTracks()[0]?.label || tracks[0]?.label || 'Fonte sem identificação').slice(0,180),
            mutedTracks:tracks.filter(t=>t.muted).length,captureMode:'tab',originalMonitored:entry.suppressed,...entry.player.stats()});
          entry.peak=0;entry.heard=false;entry.sumSquares=0;entry.sampleCount=0;
        };
        setVoice(voice); await context.resume();
        if (token !== generation) return false;
        onEvent({type:'remote-ready'});
        entry.timer=schedule(report,1000);report();return true;
      } catch(error) {
        if (token !== generation) {if(stream)release(stream);return false;}
        if(current)stop();else if(stream)release(stream);
        const reason = error.name === 'NotAllowedError' ? 'Captura cancelada ou sem permissão. Selecione a aba da reunião com áudio.' : error.message;
        onEvent({type:'remote-error',reason});return false;
      }
    }
    return { start, stop, setVoice,
      setProfile(value) { profile = ['fast','balanced','smooth'].includes(value) ? value : 'balanced'; current?.player.setProfile(profile); },
      play(data, sampleRate) { if (voice && current) current.player.play(audio.base64ToFloat32(data), sampleRate); },
    };
  }
  const api={createRemoteCapture}; globalThis.VozRemoteCapture=api;
  if(typeof module!=='undefined')module.exports=api;
})();
