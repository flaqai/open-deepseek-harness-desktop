<p align="center">
  <img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop 아이콘">
</p>

<h1 align="center">Open DeepSeek Harness Desktop</h1>

<p align="center">
  <strong>바로 사용할 수 있고 의존성 안전성을 강화한 DeepSeek Harness 데스크톱 버전</strong>
</p>

언어: [English](README.md) · [简体中文](README.zh.md) · [日本語](README.ja.md) · 한국어 · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

Open DeepSeek Harness Desktop는 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)를 macOS, Windows, Linux에서 쉽게 사용할 수 있도록 만든 독립적인 커뮤니티 데스크톱 배포판입니다. Electron은 별도의 Agent 런타임을 만들지 않고 로컬 Harness Host를 안전하게 실행·감독한 뒤 기존 Web 클라이언트를 표시합니다.

이 저장소는 DeepSeek의 공식 제품이 아닙니다. 현재 활발히 개발 중이므로 기능, 패키징 방식, 로컬 데이터 형식이 변경될 수 있습니다.

## 주요 기능

- Harness 프로세스 감독, 트레이, 알림, 로그 열기, 시작 실패 복구 기능을 갖춘 데스크톱 호스트.
- 플러그인 실행 전에 의존성 충돌을 찾고, 안전하게 복구할 수 없는 플러그인만 격리하는 보호 계층.
- 플러그인 마켓, IM 연결, Skill 선택기를 최초 실행 시 제공하며 모두 제거할 수 있습니다.
- 공식 Codex Provider와 현재 운영체제·CPU에 맞는 Codex 런타임 포함.
- 11개 테마, 채팅 배경, 로컬 이미지 업로드, 언어 및 모델 설정.
- WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord, WhatsApp 연결.
- Apple Silicon/Intel macOS, Windows x64, Linux x64용 개별 패키지.

## 설치

최신 패키지는 [GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases)에서 다운로드하세요. macOS 패키지는 ad-hoc 서명이며 공증되지 않았기 때문에 처음 실행할 때 Gatekeeper 경고가 나타날 수 있습니다. 다운로드 출처를 확인한 뒤 릴리스 페이지의 안내를 따르세요.

## 무료로 시험할 수 있는 API Token

- [Agnes AI](https://agnes-ai.com/): OpenAI 호환 Base URL은 `https://apihub.agnes-ai.com/v1`이며 Agent 및 코딩 작업의 후보 모델은 `agnes-2.5-flash`입니다.
- [OpenRouter · Ox Alpha](https://openrouter.ai/stealth/ox-alpha?view=api): Base URL은 `https://openrouter.ai/api/v1`, 모델 ID는 `stealth/ox-alpha`입니다.

두 서비스 모두 독립적인 제3자 서비스입니다. 무료 한도, 가격, 모델 이름, 속도 제한, 데이터 정책은 바뀔 수 있습니다. API Key는 Harness 자격 증명 저장소에 보관하고 Issue, 스크린샷, Git 추적 파일에 넣지 마세요.

## 문서

전체 기능, 보안 경계, 패키징 구조, 커뮤니티 플러그인 감사 표시는 [English README](README.md) 또는 [简体中文 README](README.zh.md)를 참고하세요. Harness 설계는 [공식 아키텍처 문서](docs/architecture.md)에 설명되어 있습니다.

## FLAQ AI 팀

FLAQ AI 팀은 모델 통합, 로컬 Agent 환경, 플러그인 배포, 크로스 플랫폼 앱 개발 경험을 바탕으로 이 프로젝트를 유지합니다. [FLAQ.AI](https://flaq.ai/)는 AI Agent와 프로덕션 애플리케이션을 위해 이미지, 비디오, 음악, 언어 모델에 대한 통합 API 접근을 제공합니다. FLAQ.AI는 선택 사항이며 이 소프트웨어 실행에 필요하지 않습니다.

## 라이선스

[MIT License](LICENSE). 제3자 의존성 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
