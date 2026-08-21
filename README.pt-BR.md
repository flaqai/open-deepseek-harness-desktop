<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Ícone do Open DeepSeek Harness Desktop">
</p>

<h1 align="center">Open DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>Uma edição desktop do DeepSeek Harness pronta para usar e com dependências mais seguras</strong>
</p>

Idiomas: [English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · Português

Open DeepSeek Harness Desktop é uma distribuição desktop independente e mantida pela comunidade do [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) para macOS, Windows e Linux. O Electron não cria um segundo runtime de Agent: ele inicia e supervisiona com segurança o Harness Host local e exibe o cliente Web existente.

Este repositório não é um produto oficial da DeepSeek. O projeto está em desenvolvimento ativo, portanto recursos, pacotes e formatos de dados locais podem mudar.

## Principais recursos

- Host desktop com supervisão do Harness, bandeja, notificações, acesso ao log e recuperação de falhas de inicialização.
- Detecção de conflitos de dependências antes da execução dos plugins, isolando apenas o plugin que não puder ser reparado com segurança.
- Plugin Marketplace, conexões IM e seletor de Skills configurados na primeira inicialização e sempre removíveis.
- Provider oficial do Codex e runtime do Codex correspondente ao sistema operacional e à CPU de destino.
- Onze temas, fundos de conversa, imagens locais, idioma e configuração de modelos.
- Conexões com WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord e WhatsApp.
- Pacotes separados para macOS Apple Silicon/Intel, Windows x64 e Linux x64.

## Instalação

Baixe o pacote correto em [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases). Os pacotes para macOS usam assinatura ad-hoc e não são notarizados, então o Gatekeeper pode exibir um aviso na primeira abertura. Confirme a origem do arquivo e siga as instruções da página da versão.

## Tokens de API gratuitos para avaliação

- [Agnes AI](https://agnes-ai.com/): Base URL compatível com OpenAI `https://apihub.agnes-ai.com/v1`; `agnes-2.5-flash` é uma opção atual para Agents, programação, raciocínio e ferramentas.
- [OpenRouter · Ox Alpha](https://openrouter.ai/stealth/ox-alpha?view=api): Base URL `https://openrouter.ai/api/v1` e modelo `stealth/ox-alpha`.

Ambos são serviços independentes de terceiros. Cotas gratuitas, preços, modelos, limites e políticas de dados podem mudar. Salve as chaves no armazenamento de credenciais do Harness e nunca as publique em Issues, capturas de tela ou arquivos controlados pelo Git.

## Documentação

Consulte o [README em inglês](README.md) ou o [README em chinês simplificado](README.zh.md) para conhecer todos os recursos, limites de segurança, detalhes de empacotamento e agradecimentos. A arquitetura do Harness está descrita na [documentação oficial](docs/architecture.md).

## Equipe FLAQ AI

A equipe FLAQ AI mantém este projeto a partir de sua experiência prática com integração de modelos, ambientes locais de Agent, distribuição de plugins e aplicações multiplataforma. A [FLAQ.AI](https://flaq.ai/) oferece acesso unificado por API a modelos de imagem, vídeo, música e linguagem para Agents e aplicações de produção. A FLAQ.AI é opcional e não é necessária para executar este software.

## Licença

[MIT License](LICENSE). As licenças de terceiros estão documentadas em [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
