const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = () => JSON.parse(read("manifest.json"));
const block = (world) => manifest().content_scripts.find((b) => b.world === world);

test("manifest usa a versão 3 e pede só a permissão de armazenamento", () => {
  assert.equal(manifest().manifest_version, 3);
  assert.deepEqual(manifest().permissions, ["storage"]);
  assert.equal(manifest().host_permissions, undefined);
});

test("os scripts reconhecem Meet e domínios do Teams web", () => {
  for (const b of manifest().content_scripts) {
    assert.deepEqual(b.matches, ["https://meet.google.com/*", "https://*.teams.microsoft.com/*", "https://*.teams.live.com/*", "https://*.teams.cloud.microsoft/*"]);
    assert.equal(b.match_origin_as_fallback,true);
    assert.equal(b.match_about_blank,true);
  }
});

test("o script da página carrega antes do Meet pedir o microfone", () => {
  const main = block("MAIN");
  assert.deepEqual(main.js, ["src/audio-utils.js", "src/pcm-player.js", "src/inject.js"]);
  assert.equal(main.run_at, "document_start");
});

test("o script isolado carrega o cliente antes do content.js", () => {
  assert.deepEqual(block("ISOLATED").js, [
    "src/gemini-translate.js",
    "src/session-manager.js",
    "src/status.js",
    "src/panel-dom.js",
    "src/content.js",
  ]);
});

test("todos os arquivos do manifest existem", () => {
  for (const b of manifest().content_scripts) {
    for (const file of b.js) assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  assert.ok(fs.existsSync(path.join(root, manifest().action.default_popup)));
});

test("o script da página não tem acesso à chave", () => {
  for (const file of ["src/inject.js", "src/audio-utils.js"]) {
    const source = read(file);
    assert.ok(!source.includes("apiKey"), file);
    assert.ok(!source.includes("chrome.storage"), file);
  }
});

test("o content.js não envia a chave para a página", () => {
  const source = read("src/content.js");
  for (const line of source.split("\n")) {
    if (line.includes("postMessage")) assert.ok(!line.includes("apiKey"), line);
  }
});

test("o popup oferece o idioma do usuário, com português como padrão", () => {
  assert.match(read("popup.html"), /id="my-language"/);
  assert.match(read("popup.js"), /myLanguage \?\? "pt-BR"/);
});

test('janela auxiliar carrega captura e reprodução locais, sem captura WebRTC remota',()=>{
 assert.equal(manifest().background.service_worker,'background.js');
 const scripts=[...read('receiver.html').matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);
 for(const file of ['background.js','receiver.js','receiver.css',...scripts])assert.ok(fs.existsSync(path.join(root,file)),file);
 assert.ok(!read('src/inject.js').includes('RTCPeerConnection'));
 assert.ok(!read('src/inject.js').includes('remote-play'));
});
