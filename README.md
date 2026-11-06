# Voz Traduzida — 0.3.2

Extensão do Chrome, de uso pessoal, que traduz a sua voz em tempo real no Google Meet e no Teams web. Os outros participantes não precisam instalar nada.

## Instalar

1. Abra `chrome://extensions` no Chrome.
2. Ligue o **Modo do desenvolvedor**, no canto superior direito.
3. Clique em **Carregar sem compactação** e escolha a pasta extraída que contém diretamente `manifest.json`.
4. Crie uma chave no [Google AI Studio](https://aistudio.google.com).
5. Clique no ícone da extensão, cole a chave e escolha o idioma.

## Usar

1. Abra ou recarregue a página do Meet/Teams. Se ela já estava aberta, recarregue depois de instalar.
2. Entre na chamada e clique em **Traduzir minha voz**, no painel do canto superior esquerdo.
3. Fale em frases curtas. Clique em **Voltar à voz normal** quando quiser desligar.

Em caso de falha, sua voz normal volta sozinha e o painel mostra um aviso.

### Filtros de ruído

O botão **Filtros de ruído**, na caixa "Eu", liga e desliga a supressão de ruído. A extensão solicita ajuste automático de volume desligado para preservar a dinâmica da voz. Desligados, o Gemini recebe a voz mais pura, mas ruídos como a digitação podem voltar. Se o painel pedir, recarregue a reunião para aplicar a mudança. O cancelamento de eco continua sempre ligado.

### Traduzir a outra pessoa

1. Na caixa **Outra pessoa**, escolha **Só texto** ou **Texto e voz**.
2. Clique em **Traduzir a outra pessoa**. Será aberta uma janela auxiliar. Nela, clique em **Selecionar aba com áudio**, escolha a aba da chamada do Meet/Teams e marque **Compartilhar áudio da aba**. O texto aparece no painel da reunião, no idioma escolhido em **Meu idioma**.
3. Mantenha a janela auxiliar aberta; pode minimizá-la. Em **Texto e voz**, a tradução toca só para você nessa janela, fora da aba capturada. Quando o navegador confirma que suprimiu a saída local da aba, a extensão repõe o áudio original na janela auxiliar e reduz seu volume durante a tradução em voz. Se o navegador não suprimir a saída, o original continua tocando na própria aba. Use fones.
4. Para parar, use **Parar de traduzir a outra pessoa**, **Parar captura** ou feche a janela auxiliar. A tradução do seu próprio microfone é independente.

As duas traduções são independentes, e cada uma gera o próprio custo. Se várias pessoas falarem ao mesmo tempo, as falas aparecem juntas, sem separar quem disse o quê.

## Primeiro teste

Faça uma chamada com outra conta ou outro aparelho e confira:

- [ ] **Faça este primeiro:** com o microfone mudo no Meet, fale e confira que a legenda "Você disse" não muda. Se mudar, o áudio está indo para a API mesmo no mudo: desligue a tradução e não use em reuniões.
- [ ] A outra ponta ouve a tradução.
- [ ] O atraso é aceitável.
- [ ] A voz está compreensível e sem cortes. A reprodução da sua identidade vocal depende do modelo e não é garantida.
- [ ] O final das frases é traduzido sem atraso extra depois que você para de falar.
- [ ] **Voltar à voz normal** funciona no meio de uma fala.
- [ ] Com uma chave inválida, a voz normal continua e aparece um aviso.

## Custo e privacidade

- A API só é usada enquanto a tradução está ligada. Na versão 0.3.0, o seu microfone envia áudio continuamente, inclusive silêncio, enquanto a tradução está ligada e o microfone está aberto. Isso pode aumentar o consumo em relação à versão anterior. Ao desligar ou colocar no mudo, o envio é interrompido. A tradução da outra pessoa também envia áudio continuamente enquanto a captura está ativa, inclusive durante pausas.
- O consumo e a cobrança dependem da tabela vigente do modelo Gemini e da configuração da conta.
- Na faixa gratuita, o Google pode usar o conteúdo para melhorar os produtos dele. Não use em conversas sensíveis.
- Ao traduzir a outra pessoa, a voz dela também é enviada ao Google. Avise os participantes.
- A chave fica só no armazenamento local do Chrome e é enviada apenas ao Google.

## Desenvolvimento

```bash
node --test "extension/test/*.test.js"
```

Para o teste do microfone sem hardware, rode `node extension/test/server.js`, abra `http://localhost:8123/test/harness.html` e clique em **Rodar**.


## Melhorias da versão 0.3.0

- Captura local com callbacks de 1024 amostras, em vez de 4096, com solicitação de latência interativa. A 48 kHz, cada bloco local passa de aproximadamente 85 ms para 21 ms. Isso não mede o atraso total da chamada.
- Envio do microfone em fluxo contínuo, sem o filtro local que retinha ou descartava trechos. A API continua recebendo PCM mono 16 kHz em pacotes de 100 ms, conforme a documentação do Live Translate.
- Reamostragem com estado entre callbacks, mantendo a contagem e a fase das amostras em taxas como 44,1 kHz.
- Ajuste automático de volume solicitado desligado no microfone, com cancelamento de eco mantido. O Meet, o sistema ou o dispositivo podem aplicar processamento adicional.
- Reprodução PCM contínua, sem mudar o tom, a velocidade ou descartar frases da fila. A taxa indicada no áudio é respeitada, usando 24 kHz quando omitida.
- Perfis **Menor atraso** (margem inicial de 60 ms), **Equilibrada** (120 ms, padrão) e **Mais estável** (220 ms). Em falhas de continuidade detectadas dentro do fluxo, a margem aumenta gradualmente até 350 ms. Trocar de perfil restaura a margem inicial; trechos já agendados não são alterados.
- Diagnóstico da fila de reprodução em milissegundos e da quantidade de interrupções de continuidade estimadas. Fila grande indica áudio ainda pendente de reprodução; o sistema preserva essas falas.

### Como comparar

1. Atualize os arquivos da mesma instalação, clique em Recarregar em `chrome://extensions` e recarregue o Meet.
2. Use fones e teste com outra conta/aparelho, começando por **Equilibrada**.
3. Se a voz estiver cortando, escolha **Mais estável**. Se estiver contínua, experimente **Menor atraso**.
4. Compare a supressão de ruído ligada e desligada em um ambiente silencioso. A configuração final depende do seu microfone e do ambiente.
5. Confira o mudo e o retorno à voz normal antes de usar em uma chamada.

Os números dos perfis são margens locais de reprodução, não promessas de atraso total. A indicação de atraso da tradução no painel mede retornos da API a partir de trechos enviados; não mede o instante em que o outro participante efetivamente escuta. Modelo, rede e processamento do Meet acrescentam atraso. O modelo Live Translate pode variar a identidade ou o timbre da voz; não foi adicionada uma voz TTS diferente nem clonagem de voz.

### Validação

95 testes Node passaram, incluindo o pipeline do inject em ambiente simulado, mudo, envio contínuo de silêncio, flush/retorno à voz original, reprodução PCM em sequência, recuperação de falhas de continuidade e reamostragem entre callbacks. Não houve teste auditivo, chamada real ou conexão com a API Gemini: o ambiente não tinha navegador Chromium nem chave da sua conta. As páginas HTML de teste permanecem disponíveis para validação no navegador.

Referência técnica: https://ai.google.dev/gemini-api/docs/live-api/live-translate


## Correção da captura da outra pessoa — versão 0.3.1

A captura remota não intercepta mais RTCPeerConnection nem procura elementos internos de áudio. Esses objetos podiam ser encontrados sem produzir amostras de som, resultando em pico zero e nenhum envio.

Agora a janela auxiliar da extensão captura diretamente a saída de áudio da aba selecionada, usando getDisplayMedia. A reprodução da tradução ocorre nessa outra janela para não entrar novamente na captura do Meet. A sua própria voz continua no fluxo original do microfone, com as melhorias da versão 0.3.0.

- O seletor deve receber uma **aba com áudio**. Seleções sem áudio ou de tela inteira são rejeitadas com instrução para corrigir.
- **Fonte: áudio da aba**, pico do último segundo e contador de áudio produzido aparecem no diagnóstico.
- O indicador “Enviado” conta os blocos produzidos e encaminhados ao módulo; não comprova recebimento pelo Google. Alguns blocos podem ser descartados enquanto a conexão está sendo preparada.
- Dez segundos sem sinal mostram uma mensagem de verificação; uma pausa normal da conversa também pode causar esse aviso.
- O vídeo da captura é mantido apenas para sustentar a autorização; nenhuma imagem é lida ou enviada ao Gemini.
- A captura é da aba inteira, incluindo notificações e outras mídias. Não separa pessoas por voz.
- O painel continua dentro da reunião nesta extensão; compartilhar essa aba pode mostrar o painel.

### Atualizar

Este ZIP tem **manifest.json diretamente na raiz**. Extraia em uma pasta própria. Para preservar a chave, copie os arquivos para a pasta da instalação atual, substituindo-os. Clique em **Recarregar** na extensão e depois recarregue o Meet. Se optar por uma nova instalação, configure novamente a chave.

Na reunião: **Traduzir a outra pessoa → Selecionar aba com áudio → aba do Meet → Compartilhar áudio da aba**. O seletor de captura da extensão não publica a tela na reunião. Depois que alguém falar, o pico e o contador devem aumentar.

### Validação da versão 0.3.1

107 testes Node passaram, incluindo captura da aba com áudio simulado, seleção sem áudio, seleção indevida de tela inteira, cancelamento, encerramento do compartilhamento, prevenção de início atrasado, encaminhamento à reunião correta e independência do microfone. Não houve teste em chamada real, nem validação auditiva ou com sua chave do Gemini. O teste final precisa ser feito no seu Chrome/Meet.


## Compatibilidade com Teams web — 0.3.2

- Os scripts de microfone e do painel agora reconhecem Meet e as raízes/subdomínios de teams.microsoft.com, teams.live.com e teams.cloud.microsoft. A extensão deve ser carregada antes da reunião pedir o microfone: recarregue a página após atualizar. O aplicativo desktop do Teams não carrega esta extensão.
- O painel é construído por métodos DOM, sem innerHTML, para funcionar também em páginas com restrições Trusted Types. Se a aplicação remover o painel, um observador tenta recolocá-lo; mudanças de tela cheia também tentam reposicioná-lo.
- A captura da outra pessoa já era contínua na 0.3.1 e permanece assim, inclusive para volume baixo e pausas. O limiar de fala é apenas uma estimativa para indicadores, sem bloquear o envio.
- O painel e a janela auxiliar exibem a origem informada pelo navegador, nível RMS em dBFS e aviso de sinal muito baixo. No painel também aparece a quantidade de faixas sem mídia. Sinal quase zero pode ser silêncio ou uma fonte que não contém o som da chamada.

### Atualizar e testar no Teams

1. Extraia o ZIP, copie os arquivos para a pasta atual da extensão e substitua-os para manter a chave e as preferências. O manifest.json está na raiz.
2. Em chrome://extensions ou edge://extensions, recarregue a extensão. Confirme o novo acesso aos sites do Teams, se solicitado.
3. Recarregue a página do Teams no mesmo navegador e perfil. Entre novamente na chamada se necessário.
4. Teste Traduzir minha voz com a outra ponta. Confira também o mudo e o retorno à voz normal: o teste precisa ser repetido no Teams.
5. Para a outra pessoa, abra a janela auxiliar pelo painel e selecione a aba efetiva da chamada com Compartilhar áudio da aba. A aba de chat pode ser diferente. Confira o nome em Capturando e se o pico varia quando a pessoa fala.
6. Use fones. Se o sinal ficar quase zero mesmo durante fala audível, confira a aba escolhida e a saída de áudio da reunião. O contador Enviado avança também durante pausas e não comprova voz capturada nem recebimento pela API.

A captura continua limitada à aba. Não foi adicionado áudio do computador, pois a voz traduzida reproduzida na janela auxiliar poderia entrar novamente no áudio capturado. Essa janela é mantida para reproduzir a tradução fora da aba da chamada. Nenhuma imagem é enviada à IA. A tradução envia áudio ao Google; avise os participantes e desligue ao terminar.

### Validação da versão 0.3.2

110 testes Node passaram, incluindo domínios do Teams nos dois contextos, painel sem sinks HTML, envio de volume baixo e silêncio, encaminhamento de áudio sem indicação de fala e diagnóstico. Não houve chamada real no Teams nem teste auditivo ou com chave Gemini nesta execução. O comportamento em dispositivos, políticas corporativas e telas do Teams precisa ser confirmado no uso real.
