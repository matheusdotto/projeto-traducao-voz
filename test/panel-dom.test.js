const test=require('node:test'),assert=require('node:assert/strict');
const {appendPanel}=require('../src/panel-dom.js');
class Element{
 constructor(tag){this.tag=tag;this.attributes={};this.children=[];}
 set innerHTML(v){throw Error('TrustedHTML required');}
 setAttribute(k,v){this.attributes[k]=v;}
 appendChild(node){this.children.push(node);return node;}
}
test('painel usa DOM mesmo quando a página bloqueia HTML e preserva todos os controles',()=>{
 const doc={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})},root=new Element('root');appendPanel(root,doc);
 const found=[];function walk(node){found.push(node);for(const child of node.children||[])walk(child);}walk(root);
 for(const cls of ['panel','toggle','remote-toggle','remote-input','remote-output','mode-voice','filters','size'])assert.ok(found.some(n=>(n.attributes?.class||'').split(' ').includes(cls)),cls);
 const select=found.find(n=>n.tag==='select');assert.equal(select.children.filter(n=>n.tag==='option').length,3);
 const panel=found.find(n=>n.attributes?.class==='panel');assert.ok(panel.children.some(n=>n.tag==='h1'));
});
