const test=require('node:test'),assert=require('node:assert/strict');
const {createReceiverBridge}=require('../background.js');
function setup(){
 const store={},calls=[];let windowRecord;
 const api={runtime:{getURL:p=>'chrome-extension://own/'+p,sendMessage:async m=>calls.push(['control',m])},
 storage:{session:{get:async()=>structuredClone(store),set:async v=>Object.assign(store,structuredClone(v))}},
 windows:{create:async o=>{calls.push(['create',o]);windowRecord={id:9,tabs:[{url:o.url}]};return windowRecord;},get:async()=>windowRecord,update:async()=>{}},
 tabs:{sendMessage:async(id,m)=>calls.push(['tab',id,m])}};
 return{bridge:createReceiverBridge(api),store,calls};
}
test('abre uma janela por reunião e reusa sem duplicar',async()=>{
 const h=setup(),sender={tab:{id:5}};await Promise.all([h.bridge.handle({type:'remote-open'},sender),h.bridge.handle({type:'remote-open'},sender)]);
 assert.equal(h.calls.filter(c=>c[0]==='create').length,1);await h.bridge.handle({type:'remote-open'},sender);assert.equal(h.calls.filter(c=>c[0]==='create').length,1);
});
test('eventos voltam à aba indicada pela URL confiável, ignorando ID fornecido na mensagem',async()=>{
 const h=setup();await h.bridge.handle({type:'receiver-event',tabId:999,event:{type:'remote-ready'}},{url:'chrome-extension://own/receiver.html?tabId=5'});
 assert.equal(h.calls[0][1],5);
 const result=await h.bridge.handle({type:'receiver-event',event:{}},{url:'chrome-extension://other/receiver.html?tabId=5'});assert.equal(result.ok,false);
});
test('fechar janela encerra captura apenas na reunião vinculada',async()=>{
 const h=setup();await h.bridge.handle({type:'remote-open'},{tab:{id:5}});await h.bridge.closed(9);
 assert.equal(h.store.receivers[5],undefined);assert.ok(h.calls.some(c=>c[0]==='tab'&&c[2].event.type==='remote-ended'));
});
