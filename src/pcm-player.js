// Agenda PCM contíguo, na taxa original, sem alterar a velocidade ou o tom.
(function () {
  const PROFILES = { fast: 0.06, balanced: 0.12, smooth: 0.22 };
  function createPcmPlayer(context, destination, profile = 'balanced') {
    const queued = new Set();
    let nextStart = 0, lead = PROFILES[profile] || PROFILES.balanced, underruns = 0;
    let lastArrival = null;
    function flush() {
      for (const source of queued) { source.onended = null; try { source.stop(); } catch {} }
      queued.clear(); nextStart = 0; lastArrival = null;
    }
    return {
      play(samples, rate = 24000) {
        if (!samples.length || !Number.isFinite(rate) || rate < 8000 || rate > 96000) return;
        const now = context.currentTime;
        const duration = samples.length / rate;
        // Só conta falha dentro de um fluxo; pausas longas entre frases são normais.
        const gap = nextStart > 0 && nextStart < now - 0.005 && lastArrival !== null && now - lastArrival < 1;
        if (gap) { underruns++; lead = Math.min(0.35, lead + 0.04); }
        const start = nextStart > now ? nextStart : now + lead;
        const buffer = context.createBuffer(1, samples.length, rate);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer; source.connect(destination);
        source.onended = () => queued.delete(source);
        queued.add(source); source.start(start);
        nextStart = start + duration; lastArrival = now;
      },
      setProfile(value) { profile = PROFILES[value] ? value : 'balanced'; lead = PROFILES[profile]; },
      flush,
      stats: () => ({ queued: queued.size, bufferedMs: Math.max(0, nextStart - context.currentTime) * 1000,
        leadMs: lead * 1000, underruns, profile }),
    };
  }
  const api = { createPcmPlayer, PROFILES };
  globalThis.VozPlayback = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
