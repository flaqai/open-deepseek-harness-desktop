<p align="center"><img src="./apps/desktop/src/icon.png" width="112" alt="Ícone do Open DeepSeek Harness Desktop"></p>

# Open DeepSeek Harness Desktop

<p align="center"><strong>A edição desktop comunitária do DeepSeek Harness, pronta para usar e com segurança reforçada de dependências</strong></p>

Idiomas: [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · Português

> [!IMPORTANT]
>
> **[A v0.1.2-rc.1 já está disponível: baixe e experimente](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).** Esta versão usa o DeepSeek Harness 0.1.2-rc.1 como base upstream, adiciona menus nativos e fluxos protegidos de reinicialização e encerramento, melhora os ícones do Dock e da barra de menus do macOS e corrige o escopo do proxy de sistema para o Codex e a inicialização de Profiles personalizados.
>
> Esta é uma versão candidata preliminar. Faça backup das configurações importantes antes de atualizar e inclua logs ou relatórios de diagnóstico relevantes ao comunicar problemas.

Open DeepSeek Harness Desktop é uma distribuição independente e mantida pela comunidade do [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Os instaladores incluem Node.js, pnpm e o runtime Harness, permitindo configurar modelos, executar sessões de código, revisar a execução, gerenciar plugins e Skills e conectar ferramentas externas ou bots IM sem preparar um ambiente de desenvolvimento.

> [!NOTE]
>
> Este repositório não é um produto oficial da DeepSeek. Ele continua em prévia; formatos de dados, políticas de compatibilidade e instalação ainda podem evoluir.

## Principais recursos atuais

- Espaço de conversa com largura ajustável, navegação por turnos, uso exato de Token e fila de envio.
- Importação para ambiente independente, compartilhamento direto de diretório ou início limpo.
- Descoberta de plugins com catálogo real, categorias, estado local e instalação direta.
- Diagnóstico antes da inicialização, exercícios, quarentena e recuperação para pnpm, Cordis e Loader.
- Navegação das Configurações rolável, reordenável e persistente.
- Distribuições nativas e integração desktop para Windows, macOS e Linux.

## Espaço de conversa com IA

Respostas concluídas podem recolher o processo e o System Prompt. A largura e o tamanho do texto são ajustáveis; tabelas Markdown acompanham o corpo, enquanto a navegação compacta por turnos, o uso exato de Token e o destaque contínuo de código ajudam a revisar conversas longas.

O histórico usa cartões que distinguem respostas concluídas, canceladas e interrompidas. Perguntas não enviadas permanecem ao trocar de sessão, e a próxima mensagem pode entrar na fila enquanto a sessão continua. As imagens aparecem imediatamente enquanto compressão e upload seguem em segundo plano; imagens da trilha, arquivos locais enviados e referências de arquivo ou sessão continuam válidos depois de editar o texto próximo.

## Primeira execução e ambientes independentes

Na primeira execução, o cliente verifica o diretório oficial padrão ~/.dsh. Se ele não existir ou não for compatível, você pode escolher outro diretório aceito ou criar um ambiente vazio pertencente ao Desktop.

### Importar para um ambiente independente

Configurações, credenciais, sessões, informações de workspaces, presets de Agent, Skills e conexões são copiados sem alterar a origem. Profiles, node_modules, lockfiles, runtimes de plugins, registros de quarentena/saúde e identificadores anônimos não são copiados. Os plugins são reinstalados no Profile do Desktop e as alterações posteriores ficam separadas do CLI/Web oficial.

<p align="center"><img src="./assets/readme/data-home-import-en.png" width="900" alt="Importar uma configuração DSH oficial para um ambiente independente"><br><sub>Copiar os dados compatíveis e manter a origem inalterada</sub></p>

### Usar esta configuração diretamente

Usa ~/.dsh ou outro diretório compatível sem criar uma segunda cópia. Configurações, credenciais, sessões, presets, Skills, Profiles e plugins são compartilhados; Desktop e CLI/Web alteram os mesmos dados.

<p align="center"><img src="./assets/readme/data-home-reuse-en.png" width="900" alt="Usar diretamente uma configuração DSH existente"><br><sub>Desktop compartilha os dados do diretório selecionado</sub></p>

### Começar do zero

Cria um ambiente vazio e independente sem ler ou importar configurações, sessões ou plugins existentes.

<p align="center"><img src="./assets/readme/data-home-fresh-en.png" width="900" alt="Criar um ambiente DSH independente e limpo"><br><sub>Nenhuma configuração DSH existente é lida ou alterada</sub></p>

### Escolher um diretório de dados independente

**Importar para um ambiente independente** e **Começar do zero** permitem escolher, antes de continuar, entre o local padrão gerenciado e uma pasta vazia personalizada. Essa pasta passa a ser a raiz independente do cliente; a origem não é alterada nem sincronizada. No Windows, sessões, Profiles de plugins e outros dados crescentes podem ficar em D: ou outro volume que não seja do sistema, reduzindo a pressão sobre C:.

<p align="center"><img src="./assets/readme/data-home-import-custom-location-zh.png" width="900" alt="Escolher uma pasta vazia ao importar configurações"><br><sub>Importação independente: escolher o local padrão ou uma pasta vazia antes da cópia</sub></p>

<p align="center"><img src="./assets/readme/data-home-fresh-custom-location-zh.png" width="900" alt="Escolher uma pasta vazia ao começar do zero"><br><sub>Começar do zero: colocar os novos dados independentes no local escolhido</sub></p>

Depois da configuração inicial, o diretório de dados ainda pode ser alterado em **Configurações → Configurações gerais**. É possível voltar ao diretório independente do cliente, usar diretamente o `~/.dsh` oficial, selecionar outro diretório DSH existente ou criar uma nova configuração em uma pasta vazia. A troca apenas seleciona o diretório usado após reiniciar; ela não copia, move, combina nem exclui os dados originais. Uma pasta vazia inicia novamente o fluxo de primeira instalação depois da reinicialização.

<p align="center"><img src="./assets/readme/data-home-switch-after-start-zh.png" width="900" alt="Trocar o diretório de dados nas Configurações gerais depois de entrar no cliente"><br><sub>Alternar com segurança para uma configuração existente ou criar uma nova configuração independente em uma pasta vazia</sub></p>

Depois, o assistente orienta a configuração da API Key do modelo, o acesso pelo celular, bots IM como WeChat e Feishu e uma conexão opcional com Codex. Todas as etapas podem ser ignoradas e concluídas mais tarde nas Configurações.

## Descoberta, instalação e atualização de plugins

“Explorar plugins” consulta o catálogo real do Plugin Marketplace em vez de uma lista fixa. As visualizações popular e por categoria mostram Stars, downloads dos últimos 30 dias e o estado local. Um plugin pode seguir o fluxo protegido de instalação direta ou abrir no mercado completo para consulta e gerenciamento.

O catálogo obtido com sucesso fica em cache por 24 horas; trocar de categoria não baixa tudo novamente, e a atualização manual continua disponível. O estado instalado é consultado separadamente a cada abertura. Falhas de rede mostram a causa real e, quando existe cache antigo, permitem continuar com um aviso. Plugins locais mantêm identidade verificável de pacote ou repositório, permitindo que o mercado encontre a origem online e ofereça **Restaurar**; a origem local não é atualizada diretamente e precisa ser restaurada como versão online para participar das verificações normais.

## Seleção e restauração de plugins importados

A importação independente copia a configuração e a lista de restauração, nunca o node_modules antigo. Cada entrada recebe o estado **fornecido pelo cliente**, **verificando**, **disponível online**, **fonte online indisponível** ou **temporariamente impossível verificar** por rede, timeout, autenticação ou limite de requisições.

Se a fonte online estiver indisponível, o usuário pode escolher um diretório-fonte ou .tgz. O cliente valida nome do pacote, caminhos do arquivo, manifest e tamanho; diretórios são empacotados novamente com scripts de ciclo de vida desativados. Toda restauração passa por permissões de build, diagnóstico de dependências compartilhadas e quarentena quando necessário. O node_modules antigo e endereços desconhecidos ou com credenciais nunca são executados diretamente.

<p align="center"><img src="./assets/readme/imported-plugin-restore-zh.png" width="900" alt="Verificação de fonte e restauração local de plugins importados"><br><sub>Estado da fonte, restauração online e restauração local protegida</sub></p>

## Diagnóstico super-reforçado

Plugins de terceiros compartilham o processo Node.js e o grafo de serviços Cordis do Host. Uma dependência transitiva, a forma de link do pnpm ou uma entrada antiga do Loader pode causar chamadas vazias de ferramentas, erros .prepare ou uma lista de plugins ausente antes de as Configurações abrirem.

Por isso o diagnóstico roda na composição do Profile e na camada de inicialização, não em outro plugin comum. Antes do código de terceiros, ele lê manifest, pnpm-lock.yaml, configurações do Workspace, ordem dos Bundles, grafo realmente instalado e runtime compartilhado da instalação atual.

### Da quarentena na inicialização à correção executável

A proteção acompanha a inicialização e a interface principal: primeiro a camada de boot identifica e remove o plugin incompatível, depois o cliente informa claramente o que foi isolado, e o Diagnóstico apresenta a causa, a versão original e ações concretas de atualização ou desinstalação.

<p align="center"><img src="./assets/readme/diagnostics-startup-quarantine-zh.png" width="900" alt="dsh-font incompatível sendo isolado na inicialização"><br><sub>Detectar e isolar um plugin incompatível durante a inicialização</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-quarantine-notice-zh.png" width="900" alt="Aviso de plugins isolados após a inicialização"><br><sub>Entrar com segurança na interface e mostrar exatamente o que foi isolado</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-repair-guidance-zh.png" width="900" alt="Diagnóstico mostra causa e ações de reparo"><br><sub>Mostrar causa, versão, origem anterior e opções de recuperação</sub></p>

Context, Service e Symbol do Cordis dependem da identidade física do módulo, não apenas da versão. Duas cópias de @deepseek-ai/cordis ou dsh-tools na mesma versão, mas em real paths diferentes, continuam sendo instâncias JavaScript distintas. A inspeção percorre cada plugin raiz, dependências diretas e transitivas, intervalos declarados e caminhos resolvidos; peerDependencies válidos não são sinalizados.

São verificados singletons do Host, consistência de Profile/lockfile, Bundles órfãos ou duplicados, plugins fantasmas, Store do pnpm, instalações incompletas, allowBuilds, permissões de prepare e deduplicação peer.

A ordem é **inspeção somente leitura → convergência sem perda → instalar apenas o necessário → reverificar real paths → colocar em quarentena se necessário**. Um Profile saudável não executa pnpm. Overrides gerenciados link: são usados apenas com intervalo compatível e nunca reduzem minimumReleaseAge nem substituem allowBuilds: false. O sucesso do pnpm não basta: a inicialização só continua após caminhos físicos e Loader estarem consistentes.

Se a convergência segura não puder ser comprovada, apenas o plugin raiz responsável é removido das dependências ativas e da ordem de Bundles. Especificação, versão, cadeia, motivo e data são preservados. A quarentena termina somente quando o pacote sai fisicamente do Profile, os Hosts compartilhados apontam para cópias canônicas e a reinspeção passa. Assim, o cliente explica quem falhou, por quê, qual proteção foi aplicada e o próximo passo.

Diagnóstico mostra o plugin responsável, sua versão, o motivo da quarentena e um resumo da cadeia de dependências. O usuário pode religar e tentar a recuperação, aprovar o item de build identificado, procurar uma atualização compatível no mercado ou desinstalar por completo. O plugin só retorna ao runtime depois de passar novamente pela inspeção.

### Centro de exercícios de diagnóstico

As versões de desenvolvimento e instalada incluem amostras offline para reproduzir cópias Host paralelas, Bundles órfãos, módulos ausentes, Patch inválidos, Loader duplicados, falhas de ciclo de vida, permissões de build bloqueadas e reparos interrompidos. Os cenários escolhidos são executados em sequência e exibem o cenário e a etapa atuais, cenários restantes, resultado e duração. O alvo isolado não altera o Profile do usuário; o modo avançado no Profile ativo restaura e reinspeciona ao terminar. Se uma recuperação limpa não puder ser comprovada, os plugins não reiniciam; resumos JSON e texto anonimizados são salvos e o relatório JSON pode ser exportado.

<p align="center"><img src="./assets/readme/diagnostics-lab-sandbox-zh.png" width="900" alt="Cenários isolados do centro de exercícios"><br><sub>Alvo isolado: exercitar falhas sem alterar o Profile do usuário</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-lab-live-profile-zh.png" width="900" alt="Modo avançado no Profile ativo"><br><sub>Profile ativo avançado: verificar quarentena, recuperação e reinspeção</sub></p>

> [!CAUTION]
>
> Nesta versão, não há garantia de que o exercício no Profile real seja concluído com sucesso. Faça backup da configuração ou use um diretório de dados isolado antes de executá-lo, pois há risco significativo de falha do aplicativo. Não use esse modo em produção. Se um teste real for indispensável, ative apenas um cenário por vez.

## Seleção de texto e menu de contexto

Selecionar texto somente leitura em conversas, saída de ferramentas, detalhes ou prévias de arquivos mostra uma barra horizontal. Clicar com o botão direito na seleção abre um menu vertical arredondado.

- **Copiar** para a área de transferência.
- **Perguntar em uma nova conversa** sem enviar automaticamente.
- **Adicionar à conversa atual** como citação Markdown sem substituir o rascunho.

Quando a sessão aguarda escolha, confirmação ou resposta, ou o editor está desativado, “Adicionar à conversa atual” é ocultado automaticamente.

<p align="center">
  <strong>Barra de seleção</strong><br>
  <img src="./assets/readme/selection-toolbar-zh.png" width="900" alt="Barra horizontal após selecionar texto">
</p>

<p align="center">
  <strong>Menu de contexto</strong><br>
  <img src="./assets/readme/selection-context-menu-zh.png" width="900" alt="Menu vertical ao clicar com o botão direito">
</p>

## Experiência desktop

- Execução na bandeja, saída completa e reinício rápido pela barra de menus do macOS ou bandeja do Windows/Linux.
- Notificações de falha e recuperação, acesso ao log fixo do Harness e ajuda após 15 segundos de espera.
- Verificação de Release, progresso de download, validação de SHA256SUMS e abertura do instalador nas Configurações gerais.
- Registro e remoção seguros do comando dsh incluído no PATH do sistema.
- Barra de título personalizada no Windows/Linux, comportamento nativo no macOS e escrita limitada na área de transferência.
- Codex e Claude Code são instalados sob demanda em **Configurações → Ferramentas externas**, não incluídos nos instaladores.

### Plugins predefinidos

O instalador inclui cinco presets de inicialização como arquivos locais com integridade verificada: Plugin Marketplace, dsh-im, dsh-skill-picker, Better Sidebar e dsh-pocket. `dsh-font` é fornecido somente como amostra para os exercícios de diagnóstico. Quando o usuário desinstala um preset, o cliente não o reinstala automaticamente.

<p align="center"><img src="./assets/readme/preset-mobile-access-zh.png" width="900" alt="Conectar um celular pelo QR code ou endereço LAN do Pocket"><br><sub>Acesso móvel: escanear na mesma rede e ativar acesso público somente quando necessário</sub></p>

<p align="center"><img src="./assets/readme/preset-im-robot-zh.png" width="900" alt="Conectar WeChat e outros bots IM pelo dsh-im"><br><sub>Bots IM: WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord e WhatsApp</sub></p>

A versão local incluída facilita a preparação offline, mas não acompanha diretamente as atualizações do mercado. Ao ficar online, abra **Mercado de plugins → Instalados** e use **Restaurar** em cada preset para substituí-lo pela versão online. A restauração não pode ser revertida automaticamente; mantenha a versão local se preferir um pacote offline fixo.

<p align="center"><img src="./assets/readme/preset-plugin-restore-online-zh.png" width="900" alt="Restaurar presets locais como versões online"><br><sub>Recomendado: restaurar quando estiver online para receber verificações normais de atualização</sub></p>

### Navegação personalizável das Configurações

A navegação esquerda das Configurações tem rolagem própria, mantendo acessíveis as seções adicionadas por plugins. As seções podem ser arrastadas e a ordem é salva localmente, sendo mesclada de forma estável quando plugins são instalados ou removidos. No Windows e Linux, a barra de título e o conteúdo Harness usam visualizações nativas separadas, portanto um plugin em tela cheia não pode cobrir os controles da janela.

<p align="center"><img src="./assets/readme/settings-navigation-reorder-zh.png" width="900" alt="Reordenar Configurações pelas alças de três linhas"><br><sub>Arraste livremente as seções; as outras linhas abrem espaço suavemente e a ordem final é salva</sub></p>

## Temas e fundos

Suporta sistema, claro, escuro e oito temas de produto, oito ilustrações integradas e fundos locais PNG/JPEG/WebP. Imagens personalizadas permanecem no armazenamento local do navegador e não são enviadas ao modelo.

<table><tr><th width="50%">Temas</th><th width="50%">Fundos</th></tr><tr><td align="center"><img src="./assets/readme/theme-settings-en.png" alt="Configurações de temas"></td><td align="center"><img src="./assets/readme/background-settings-en.png" alt="Configurações de fundos"></td></tr></table>

## Download e instalação

Baixe o pacote adequado em [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).

| Sistema | Arquitetura | Pacote |
| --- | --- | --- |
| macOS | Apple Silicon arm64 | DeepSeek-Harness-macos-arm64.dmg |
| macOS | Intel x64 | DeepSeek-Harness-macos-x64.dmg |
| Windows | x64 | DeepSeek-Harness-windows-x64.exe |
| Linux | Debian / Ubuntu x64 | DeepSeek-Harness-linux-x64.deb |
| Linux | Fedora / RHEL x64 | DeepSeek-Harness-linux-x64.rpm |

Verifique os arquivos com SHA256SUMS. Builds macOS usam assinatura ad-hoc e não são notarizados; se o Gatekeeper bloquear, use **Ajustes do Sistema → Privacidade e Segurança → Abrir Mesmo Assim**. O Windows pode exibir aviso de reputação para builds novos ou sem assinatura.

## Executar a partir do código-fonte

Instale Node.js ^22.19.0 ou 24+ e pnpm 11.7.0:

    git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
    cd open-deepseek-harness-desktop
    pnpm install
    pnpm run build
    pnpm run dev:desktop

Para somente Web, use pnpm dsh web. O Web do código-fonte usa o DSH_HOME atual, normalmente ~/.dsh; o Desktop instalado usa o diretório escolhido na primeira execução. O compartilhamento depende dessa escolha.

## Segurança, comunidade e licença

O renderer desativa integração Node e ativa context isolation e sandbox do Chromium. A navegação é limitada à origem loopback exata do Harness; não há bridge genérica para comandos, arquivos ou URLs arbitrários. Armazene API Keys no serviço de credenciais do Harness.

- [Guia do usuário](docs/user/guide/index.md), [guia de plugins](docs/user/develop/framework/index.md), [guia de Skills](docs/subsystems/skills.md)
- Bugs e sugestões: [GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues)
- Upstream: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Open DeepSeek Harness Desktop é disponibilizado sob a [Licença MIT](LICENSE). Licenças de terceiros estão em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Friends

- [DSHFind](https://dshfind.com/zh) — comunidade chinesa de aprendizado e compartilhamento sobre DeepSeek Harness.
