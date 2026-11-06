(function(){
  const params=new URLSearchParams(location.search);
  const tabId=Number(params.get('tabId'));
  const status=document.getElementById('status'),diagnostic=document.getElementById('diagnostic');
  const startButton=document.getElementById('start'),voiceBox=document.getElementById('voice');
  let active=false;
  function publish(event){chrome.runtime.sendMessage({type:'receiver-event',event}).then(result=>{if(!result?.ok)throw Error('Reunião indisponível');}).catch(()=>{
    capture.stop();active=false;startButton.disabled=false;status.textContent='A aba da reunião não está disponível. Reabra a captura pelo painel da reunião.';
  });}
  const capture=globalThis.VozRemoteCapture.createRemoteCapture({onEvent(event){
    if(event.type==='remote-ready'){active=true;startButton.disabled=true;status.textContent='Áudio capturado. Conectando a tradução no painel da reunião.';}
    if(event.type==='remote-error'||event.type==='remote-ended'){
      active=false;startButton.disabled=false;status.textContent=event.reason||'Compartilhamento encerrado.';
    }
    if(event.type==='remote-state'){
      status.textContent=event.silentSeconds>=10?'Sem som há 10 s ou mais. Se a pessoa fala, confira a aba escolhida.':event.weakSeconds>=10?'Sinal muito baixo ou pausa. Confira a aba da chamada e a saída de áudio.':'Captura ativa. As legendas aparecem na reunião.';
      diagnostic.textContent=`Pico: ${event.peak.toFixed(4)} · Áudio produzido: ${(event.sentFrames/10).toFixed(1)} s · Fonte: áudio da aba · Nível: ${event.signalDb === null ? "silêncio" : event.signalDb.toFixed(1)+" dBFS"} · Capturando: ${event.sourceLabel}`;
    }
    publish(event);
  }});
  voiceBox.checked=params.get('voice')==='true';capture.setVoice(voiceBox.checked);capture.setProfile(params.get('profile'));
  function stop(){capture.stop();active=false;startButton.disabled=false;status.textContent='Captura desligada.';publish({type:'remote-ended'});}
  startButton.addEventListener('click',()=>{startButton.disabled=true;status.textContent='Escolha a aba da reunião no seletor.';capture.start().then(ok=>{if(!ok&&!active)startButton.disabled=false;});});
  document.getElementById('stop').addEventListener('click',stop);
  voiceBox.addEventListener('change',()=>{capture.setVoice(voiceBox.checked);publish({type:'remote-voice-state',voice:voiceBox.checked});});
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id!==chrome.runtime.id||message.type!=='receiver-control'||message.tabId!==tabId)return;
    if(message.command==='stop')stop();
    else if(message.command==='voice'){voiceBox.checked=message.voice===true;capture.setVoice(voiceBox.checked);}
    else if(message.command==='profile')capture.setProfile(message.profile);
    else if(message.command==='sync'&&active)publish({type:'remote-ready'});
    else if(message.command==='play')capture.play(message.data,message.sampleRate);
  });
  window.addEventListener('pagehide',()=>capture.stop(),{once:true});
})();
