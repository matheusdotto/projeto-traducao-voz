(function(){
  function createReceiverBridge(api){
    const locks=new Map();
    const getRecords=async()=>((await api.storage.session.get('receivers')).receivers||{});
    const emit=(tabId,event)=>api.tabs.sendMessage(tabId,{type:'remote-window-event',event});
    function sourceTab(sender){
      try{
        const url=new URL(sender.url);
        const expected=new URL(api.runtime.getURL('receiver.html'));
        if(url.protocol!==expected.protocol||url.host!==expected.host||url.pathname!=='/receiver.html')return null;
        const value=url.searchParams.get('tabId');
        const id=Number(value);return value!==null&&Number.isInteger(id)&&id>=0?id:null;
      }catch{return null;}
    }
    async function open(tabId,message){
      const records=await getRecords(),previous=records[tabId];
      if(previous){
        try{
          const existing=await api.windows.get(previous.windowId,{populate:true});
          if(existing.tabs?.some(t=>t.url===previous.url)){
            await api.windows.update(existing.id,{focused:true,...(existing.state==='minimized'?{state:'normal'}:{})});
            await api.runtime.sendMessage({type:'receiver-control',tabId,command:'voice',voice:message.voice});
            await api.runtime.sendMessage({type:'receiver-control',tabId,command:'profile',profile:message.profile});
            await api.runtime.sendMessage({type:'receiver-control',tabId,command:'sync'});
            return {ok:true};
          }
        }catch{}
      }
      const params=new URLSearchParams({tabId:String(tabId),voice:String(message.voice===true),profile:message.profile||'balanced'});
      const url=api.runtime.getURL('receiver.html')+'?'+params;
      const created=await api.windows.create({url,type:'popup',width:540,height:460,focused:true});
      // Releia antes de gravar para preservar registros de outras reuniões.
      const latest=await getRecords();latest[tabId]={windowId:created.id,url};await api.storage.session.set({receivers:latest});
      return {ok:true};
    }
    return {
      async handle(message,sender){
        if(message?.type==='receiver-event'){
          const tabId=sourceTab(sender);if(tabId===null)return {ok:false};
          await emit(tabId,message.event);return {ok:true};
        }
        const tabId=sender.tab?.id;
        if(!Number.isInteger(tabId))return null;
        if(message?.type==='remote-open'){
          if(!locks.has(tabId))locks.set(tabId,open(tabId,message).finally(()=>locks.delete(tabId)));
          return locks.get(tabId);
        }
        if(message?.type==='remote-control'){
          await api.runtime.sendMessage({...message,type:'receiver-control',tabId});return {ok:true};
        }
        return null;
      },
      async closed(windowId){
        const records=await getRecords();
        for(const [tabId,record]of Object.entries(records))if(record.windowId===windowId){
          delete records[tabId];await emit(Number(tabId),{type:'remote-ended'}).catch(()=>{});
        }
        await api.storage.session.set({receivers:records});
      },
    };
  }
  if(typeof module!=='undefined')module.exports={createReceiverBridge};
  if(typeof chrome==='undefined')return;
  const bridge=createReceiverBridge(chrome);
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(!['remote-open','remote-control','receiver-event'].includes(message?.type))return;
    bridge.handle(message,sender).then(result=>sendResponse(result)).catch(error=>sendResponse({ok:false,reason:error.message}));return true;
  });
  chrome.windows.onRemoved.addListener(id=>bridge.closed(id).catch(()=>{}));
})();
