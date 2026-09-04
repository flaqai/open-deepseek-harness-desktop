<p align="center"><img src="./apps/desktop/src/icon.png" width="112" alt="Open DeepSeek Harness Desktop 아이콘"></p>

# Open DeepSeek Harness Desktop

<p align="center"><strong>바로 사용할 수 있고 의존성 안전성을 강화한 DeepSeek Harness 커뮤니티 데스크톱 버전</strong></p>

언어: [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · 한국어 · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português](README.pt-BR.md)

> [!IMPORTANT]
>
> **[v0.1.2-rc.1이 출시되었습니다. 다운로드해 사용해 보세요](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1).** 이 릴리스는 DeepSeek Harness 0.1.2-rc.1을 기반으로 네이티브 애플리케이션 메뉴와 보호된 재시작·종료 흐름을 추가합니다. macOS Dock·메뉴 막대 아이콘을 개선하고 Codex 시스템 프록시의 적용 범위와 사용자 지정 Profile 시작 호환성도 수정했습니다.
>
> 이 버전은 Release Candidate 프리릴리스입니다. 업그레이드 전에 중요한 설정을 백업하고, 문제를 보고할 때 관련 로그나 진단 보고서를 첨부해 주세요.

Open DeepSeek Harness Desktop는 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)를 기반으로 하는 독립적인 커뮤니티 배포판입니다. 설치 프로그램에 Node.js, pnpm, Harness 런타임이 포함되어 모델 설정, 코딩 세션, 실행 기록, 플러그인과 Skill, 외부 코딩 도구 및 IM 봇을 별도 개발 환경 없이 사용할 수 있습니다.

> [!NOTE]
>
> 이 저장소는 DeepSeek의 공식 제품이 아닙니다. 현재 프리뷰 단계이므로 데이터 형식, 플러그인 호환 정책, 설치 방식이 계속 변경될 수 있습니다.

## 현재 주요 기능

- 조절 가능한 본문, 턴 탐색, 정확한 Token 사용량과 전송 대기열을 갖춘 AI 대화 작업 공간.
- 공식 설정을 독립 환경으로 가져오기, 기존 디렉터리 공유 또는 완전히 새로 시작하기.
- 실제 시장 데이터, 분류, 로컬 상태와 직접 설치를 사용하는 플러그인 탐색.
- 시작 전 pnpm, Cordis, Loader를 검사하는 진단, 연습, 격리와 복구.
- 스크롤, 드래그 순서 변경과 사용자 순서 저장을 지원하는 설정 탐색.
- Windows, macOS, Linux 네이티브 배포와 데스크톱 통합.

## AI 대화 작업 공간

완료된 답변의 처리 내용과 System Prompt를 접을 수 있습니다. 본문 너비와 글자 크기를 조절할 수 있고 Markdown 표, 간결한 턴 탐색, 답변별 정확한 Token 사용량, 스트리밍 코드 하이라이트가 긴 대화를 확인하기 쉽게 만듭니다.

질문 기록은 완료, 취소, 중단 상태를 구분하는 카드로 표시됩니다. 세션을 바꿔도 보내지 않은 질문을 유지하고, 실행 중인 세션에도 다음 메시지를 전송 대기열로 추가할 수 있습니다. 이미지는 즉시 보이며 압축과 업로드는 백그라운드에서 계속됩니다. 실행 기록 이미지, 업로드한 로컬 파일, 편집 후에도 유지되는 파일과 세션 참조도 지원합니다.

## 첫 실행과 독립 데이터 환경

처음 실행할 때 기본 공식 DSH 디렉터리 ~/.dsh를 확인합니다. 디렉터리가 없거나 지원되지 않아도 다른 지원 디렉터리를 직접 선택하거나 빈 데스크톱 전용 환경을 만들 수 있습니다.

### 독립 환경으로 가져오기

설정, 자격 증명, 세션, 작업 공간 정보, Agent 프리셋, Skill, 연결 상태를 데스크톱 전용 디렉터리로 복사하며 원본은 변경하지 않습니다. Profile, node_modules, 잠금 파일, 플러그인 런타임, 격리·상태 기록, 익명 식별자는 복사하지 않습니다. 플러그인은 데스크톱 Profile에 다시 설치되며 이후 공식 CLI/Web과 독립적으로 변경됩니다.

<p align="center"><img src="./assets/readme/data-home-import-en.png" width="900" alt="공식 DSH 설정을 독립 데스크톱 환경으로 가져오기"><br><sub>지원 데이터만 복사하고 원본 환경은 유지합니다</sub></p>

### 이 설정을 직접 사용

공식 ~/.dsh 또는 직접 선택한 지원 디렉터리를 복사 없이 사용합니다. 설정, 자격 증명, 세션, Agent 프리셋, Skill, Profile, 플러그인이 공유되며 Desktop과 공식 CLI/Web의 변경은 같은 데이터에 반영됩니다.

<p align="center"><img src="./assets/readme/data-home-reuse-en.png" width="900" alt="기존 DSH 설정을 데스크톱에서 직접 사용"><br><sub>선택한 디렉터리와 모든 지원 데이터를 공유합니다</sub></p>

### 새로 시작

기존 설정, 세션, 플러그인을 읽지 않고 완전히 독립적인 빈 환경을 만듭니다.

<p align="center"><img src="./assets/readme/data-home-fresh-en.png" width="900" alt="새로운 독립 DSH 환경 만들기"><br><sub>기존 DSH 설정을 읽거나 변경하지 않습니다</sub></p>

### 독립 데이터 디렉터리 직접 선택

**독립 환경으로 가져오기**와 **새로 시작** 모두 계속하기 전에 관리형 기본 위치나 비어 있는 사용자 지정 폴더를 선택할 수 있습니다. 선택한 빈 폴더가 이 클라이언트의 독립 데이터 루트가 되며 원본 설정은 변경되거나 동기화되지 않습니다. Windows에서는 계속 커지는 세션과 플러그인 Profile을 D 드라이브 등 비시스템 볼륨에 두어 C 드라이브 부담을 줄일 수 있습니다.

<p align="center"><img src="./assets/readme/data-home-import-custom-location-zh.png" width="900" alt="설정 가져오기 중 비어 있는 사용자 지정 디렉터리 선택"><br><sub>독립 가져오기: 복사 전에 기본 위치 또는 빈 폴더 선택</sub></p>

<p align="center"><img src="./assets/readme/data-home-fresh-custom-location-zh.png" width="900" alt="새로 시작할 때 비어 있는 사용자 지정 디렉터리 선택"><br><sub>새로 시작: 독립 데이터를 사용자가 선택한 위치에 저장</sub></p>

최초 설정을 마친 뒤에도 **설정 → 일반 설정**에서 데이터 디렉터리를 바꿀 수 있습니다. 클라이언트 독립 디렉터리로 돌아가거나, 공식 `~/.dsh`를 직접 사용하거나, 다른 기존 DSH 디렉터리를 선택하거나, 빈 폴더에 새 구성을 만들 수 있습니다. 전환은 재시작 후 사용할 디렉터리만 선택하며 기존 데이터를 복사, 이동, 병합 또는 삭제하지 않습니다. 빈 폴더를 선택하면 재시작 후 최초 설치 절차가 다시 시작됩니다.

<p align="center"><img src="./assets/readme/data-home-switch-after-start-zh.png" width="900" alt="클라이언트 진입 후 일반 설정에서 데이터 디렉터리 전환"><br><sub>기존 구성을 안전하게 전환하거나 빈 폴더에 새 독립 구성 생성</sub></p>

진입 후 설정 마법사에서 모델 API Key, 휴대폰 접속, WeChat·Feishu 등 IM 봇과 선택적인 Codex 연결을 구성할 수 있습니다. 모든 단계는 건너뛰고 나중에 설정에서 완료할 수 있습니다.

## 플러그인 탐색, 설치와 업데이트

“플러그인 탐색”은 고정 목록 대신 Plugin Marketplace의 실제 카탈로그를 읽습니다. 인기 및 분류별 보기에서 Star, 최근 30일 다운로드 수와 로컬 설치 상태를 표시하며, 보호된 직접 설치 또는 전체 시장 관리 화면으로 이동할 수 있습니다.

카탈로그는 성공 후 24시간 캐시되며 분류 전환은 전체 목록을 다시 요청하지 않습니다. 설치 상태는 열 때마다 별도로 갱신되고 사용자는 언제든 수동 새로 고침할 수 있습니다. 네트워크 오류는 실제 원인을 표시하며, 이전 캐시가 있으면 만료 경고와 함께 계속 탐색할 수 있습니다. 로컬 디렉터리나 아카이브로 설치한 플러그인은 검증 가능한 패키지와 저장소 정보를 유지하므로 시장이 온라인 출처와 **복원** 항목을 찾을 수 있습니다. 다만 로컬 출처 자체는 업데이트되지 않으며 정상 업데이트 검사를 받으려면 온라인 버전으로 복원해야 합니다.

## 가져온 플러그인 선택과 복원

독립 환경 가져오기는 플러그인 설정과 복원 목록만 복사하고 이전 node_modules는 사용하지 않습니다. 복원 화면은 다음 출처 상태를 표시합니다.

- **클라이언트 제공**: 번들 프리셋이 이미 충족합니다.
- **확인 중**: 활성 Profile을 변경하지 않고 임시 디렉터리에서 출처를 검사합니다.
- **온라인 복원 가능**: 내장 pnpm으로 다시 설치할 수 있습니다.
- **온라인 출처 없음**: 패키지, 저장소 또는 Git 참조가 존재하지 않습니다.
- **일시적으로 확인 불가**: 오프라인, 시간 초과, 인증 실패 또는 속도 제한으로 나중에 재시도할 수 있습니다.

온라인 출처를 사용할 수 없으면 사용자가 소스 디렉터리나 .tgz를 선택할 수 있습니다. 클라이언트는 패키지 이름, 아카이브 경로, manifest 크기와 전체 크기를 검증하고, 소스 디렉터리는 수명 주기 스크립트를 비활성화한 채 다시 패키징합니다. 모든 복원은 빌드 승인, 공유 의존성 진단, 필요한 격리를 거칩니다. 기존 node_modules나 자격 증명이 포함된 알 수 없는 주소를 직접 실행하지 않습니다.

<p align="center"><img src="./assets/readme/imported-plugin-restore-zh.png" width="900" alt="가져온 플러그인의 온라인 출처 확인과 로컬 복원"><br><sub>출처 상태, 온라인 복원, 안전한 로컬 복원</sub></p>

## 강화된 진단 검사

타사 플러그인은 Host와 같은 Node.js 프로세스 및 Cordis 서비스 그래프를 공유합니다. 전이 의존성, pnpm 링크 방식, 오래된 Loader 항목만으로도 설정이 열리기 전에 빈 도구 호출, .prepare 오류, 사라진 플러그인 목록이 발생할 수 있습니다.

따라서 진단은 일반 플러그인이 아니라 Profile 구성과 부팅 계층에서 실행됩니다. 타사 코드보다 먼저 manifest, pnpm-lock.yaml, Workspace 설정, Bundle 순서, 실제 설치 그래프와 현재 설치본의 공유 런타임을 읽습니다.

### 시작 격리부터 실행 가능한 복구까지

보호는 시작과 기본 화면 전체에 이어집니다. 부팅 계층이 호환되지 않는 플러그인을 먼저 찾아 제거하고, 클라이언트가 격리 결과를 알리며, 진단 화면은 원인과 원래 버전, 업데이트 또는 제거 작업을 제공합니다.

<p align="center"><img src="./assets/readme/diagnostics-startup-quarantine-zh.png" width="900" alt="시작 중 호환되지 않는 dsh-font 격리"><br><sub>시작 단계에서 호환되지 않는 플러그인 탐지 및 격리</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-quarantine-notice-zh.png" width="900" alt="시작 후 격리 결과 알림"><br><sub>안전하게 기본 화면에 진입한 뒤 격리 결과를 명확히 표시</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-repair-guidance-zh.png" width="900" alt="진단 화면의 원인과 복구 작업"><br><sub>원인, 버전, 기존 설치 출처와 실행 가능한 복구 작업 제공</sub></p>

Cordis Context, Service, Symbol은 버전 번호뿐 아니라 물리 모듈의 정체성에 의존합니다. 같은 버전이라도 다른 real path에 설치된 @deepseek-ai/cordis 또는 dsh-tools는 서로 다른 JavaScript 인스턴스입니다. 검사는 각 루트 플러그인에서 직접·간접 의존성, 선언 범위, 최종 경로를 추적합니다. 올바른 peerDependencies는 오탐하지 않습니다.

검사 범위에는 공유 Host 싱글턴, Profile·잠금 파일 일관성, 고아·중복 Bundle, 유령 플러그인, pnpm Store, 불완전한 설치, allowBuilds, prepare 승인, peer 중복 제거 설정이 포함됩니다.

복구 순서는 **읽기 전용 검사 → 무손실 수렴 → 필요한 의존성만 설치 → real path 재검사 → 필요 시 격리**입니다. 정상 Profile에서는 pnpm을 실행하지 않습니다. 호환되는 경우 관리형 link: override를 사용하지만 minimumReleaseAge나 명시적인 allowBuilds: false를 완화하지 않습니다. pnpm이 성공해도 물리 경로와 Loader 상태가 재검사를 통과해야 시작합니다.

안전하게 통합할 수 없으면 원인이 된 루트 플러그인만 활성 의존성과 Bundle 순서에서 제거하고 원래 사양, 버전, 의존 경로, 이유와 시간을 보존합니다. 패키지가 실제 Profile에서 빠지고 공유 Host가 표준 복사본을 가리키며 재검사가 성공해야 격리가 완료됩니다. 즉, 이해하기 어려운 스택을 “누가, 왜 실패했고, 어떤 보호를 적용했으며, 다음에 무엇을 할지”로 바꿉니다.

진단 화면은 책임 플러그인, 버전, 격리 이유와 의존성 체인 요약을 표시합니다. 다시 연결하여 복구하거나, 진단이 특정한 빌드 항목을 승인하거나, 시장에서 호환 업데이트를 찾거나, 플러그인을 완전히 제거할 수 있습니다. 복구 작업 후에도 같은 검사와 재검사를 통과해야 플러그인이 런타임으로 돌아갑니다.

### 진단 연습 센터

개발판과 설치판 모두 오프라인 고정 샘플로 Host 중복 복사본, 고아 Bundle, 누락 모듈, 잘못된 Patch, 중복 Loader, 수명 주기 실패, 빌드 승인 차단과 중단된 복구를 재현합니다. 선택한 시나리오를 차례로 실행하며 현재 시나리오, 단계, 남은 시나리오, 통과 상태와 시간을 표시합니다. 기본 격리 모드는 사용자 Profile을 변경하지 않고, 고급 실제 Profile 모드는 종료 시 복원과 재검사를 수행합니다. 깨끗한 복구를 확인하지 못하면 Profile 플러그인을 다시 시작하지 않으며 익명화된 JSON과 텍스트 요약을 저장하고 JSON 보고서를 내보낼 수 있습니다.

<p align="center"><img src="./assets/readme/diagnostics-lab-sandbox-zh.png" width="900" alt="진단 연습 센터의 격리 샌드박스"><br><sub>격리 샌드박스: 사용자 Profile을 바꾸지 않고 여러 오프라인 장애 연습</sub></p>

<p align="center"><img src="./assets/readme/diagnostics-lab-live-profile-zh.png" width="900" alt="진단 연습 센터의 실제 Profile 모드"><br><sub>고급 실제 Profile 연습: 실제 격리, 복원, 재검사 경로 검증</sub></p>

> [!CAUTION]
>
> 이 릴리스에서는 실제 Profile 연습이 반드시 성공한다고 보장할 수 없습니다. 충돌 위험이 높으므로 실행 전에 설정을 백업하거나 격리된 데이터 디렉터리를 사용하세요. 이 모드를 운영 환경에서 사용하지 마세요. 실제 테스트가 꼭 필요해도 한 번에 하나의 시나리오만 활성화하세요.

## 텍스트 선택과 오른쪽 클릭 메뉴

대화, 도구 출력, 세부 정보, 파일 미리보기의 읽기 전용 텍스트를 선택하면 가로 작업 표시줄이 나타나며, 선택 영역을 오른쪽 클릭하면 세로형 둥근 메뉴가 나타납니다.

- **복사**: 선택 내용을 시스템 클립보드에 저장합니다.
- **새 대화에서 질문**: 현재 작업 공간에 새 대화를 만들고 내용을 채우지만 자동 전송하지 않습니다.
- **현재 대화에 추가**: 기존 초안을 덮어쓰지 않고 Markdown 인용문으로 추가합니다.

현재 세션이 선택·확인·답변을 기다리거나 입력창이 비활성화되면 “현재 대화에 추가”는 자동으로 숨겨집니다.

<p align="center">
  <strong>선택 작업 표시줄</strong><br>
  <img src="./assets/readme/selection-toolbar-zh.png" width="900" alt="텍스트 선택 후 가로 작업 표시줄">
</p>

<p align="center">
  <strong>오른쪽 클릭 메뉴</strong><br>
  <img src="./assets/readme/selection-context-menu-zh.png" width="900" alt="선택 텍스트의 세로 오른쪽 클릭 메뉴">
</p>

## 데스크톱 경험

- 트레이 실행과 완전 종료, macOS 메뉴 막대 및 Windows/Linux 트레이의 빠른 재시작.
- 시작 실패·복구 알림, 고정 Harness 로그 위치, 15초 이상 대기 시 로그 열기.
- 일반 설정에서 Release 확인, 다운로드 진행률, SHA256SUMS 검증, 설치 프로그램 열기.
- 내장 dsh 명령을 시스템 PATH에 안전하게 등록하거나 제거.
- Windows/Linux 사용자 지정 제목 표시줄, macOS 기본 동작, 제한된 클립보드 쓰기.
- Codex와 Claude Code는 번들에서 제외되며 설정 → 외부 도구에서 필요한 공식 패키지만 온라인 설치합니다.

### 프리셋 플러그인

설치 프로그램에는 무결성을 확인한 로컬 아카이브로 Plugin Marketplace, dsh-im, dsh-skill-picker, Better Sidebar, dsh-pocket의 5개 시작 프리셋이 포함됩니다. `dsh-font`는 진단 연습 샘플로만 제공됩니다. 사용자가 프리셋을 제거하면 클라이언트가 자동으로 다시 설치하지 않습니다.

<p align="center"><img src="./assets/readme/preset-mobile-access-zh.png" width="900" alt="Pocket QR 코드 또는 LAN 주소로 휴대폰 연결"><br><sub>휴대폰 접속: 같은 네트워크에서 스캔하고 필요할 때만 공용 접속 활성화</sub></p>

<p align="center"><img src="./assets/readme/preset-im-robot-zh.png" width="900" alt="dsh-im으로 WeChat 등 IM 봇 연결"><br><sub>IM 봇: WeChat, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord, WhatsApp 연결</sub></p>

설치 프로그램의 로컬 버전은 오프라인 준비에 유용하지만 시장 업데이트를 직접 받지 않습니다. 온라인 상태가 되면 **플러그인 시장 → 설치됨**에서 각 프리셋의 **복원**을 눌러 온라인 버전으로 교체하는 것을 권장합니다. 복원은 자동으로 되돌릴 수 없으므로 고정된 오프라인 버전이 더 중요하면 그대로 유지할 수 있습니다.

<p align="center"><img src="./assets/readme/preset-plugin-restore-online-zh.png" width="900" alt="로컬 프리셋을 온라인 버전으로 복원"><br><sub>권장: 온라인에서 복원을 눌러 정상 업데이트 검사를 받는 온라인 버전으로 전환</sub></p>

### 설정 탐색 사용자 지정

설정 왼쪽 탐색은 독립적으로 스크롤되어 플러그인이 항목을 추가해도 뒤쪽 항목이 잘리지 않습니다. 사용자는 항목을 드래그해 순서를 바꾸고 로컬에 저장할 수 있으며, 플러그인 설치와 제거 후에도 기존 순서에 안정적으로 병합됩니다. Windows와 Linux에서는 제목 표시줄과 Harness 콘텐츠가 별도 네이티브 뷰를 사용하므로 전체 화면 플러그인이 창 제어 버튼을 덮을 수 없습니다.

<p align="center"><img src="./assets/readme/settings-navigation-reorder-zh.png" width="900" alt="세 줄 핸들로 설정 탐색 순서 변경"><br><sub>설정 항목을 자유롭게 끌면 다른 행이 부드럽게 자리를 비우고 최종 순서가 저장됩니다</sub></p>

## 테마와 배경

시스템, 라이트, 다크 및 8개 제품 테마, 8개 내장 일러스트, 로컬 PNG/JPEG/WebP 배경을 지원합니다. 사용자 이미지는 로컬 브라우저 저장소에만 보관되고 모델로 전송되지 않습니다.

<table><tr><th width="50%">테마</th><th width="50%">배경</th></tr><tr><td align="center"><img src="./assets/readme/theme-settings-en.png" alt="테마 설정"></td><td align="center"><img src="./assets/readme/background-settings-en.png" alt="배경 설정"></td></tr></table>

## 다운로드 및 설치

[GitHub Releases](https://github.com/flaqai/open-deepseek-harness-desktop/releases/tag/odsh-v0.1.2-rc.1)에서 운영체제에 맞는 파일을 다운로드하세요.

| 운영체제 | 아키텍처 | 패키지 |
| --- | --- | --- |
| macOS | Apple Silicon arm64 | DeepSeek-Harness-macos-arm64.dmg |
| macOS | Intel x64 | DeepSeek-Harness-macos-x64.dmg |
| Windows | x64 | DeepSeek-Harness-windows-x64.exe |
| Linux | Debian / Ubuntu x64 | DeepSeek-Harness-linux-x64.deb |
| Linux | Fedora / RHEL x64 | DeepSeek-Harness-linux-x64.rpm |

SHA256SUMS로 다운로드를 검증하세요. macOS 빌드는 ad-hoc 서명이고 공증되지 않았습니다. 차단되면 “시스템 설정 → 개인정보 보호 및 보안 → 그래도 열기”를 사용하세요. Windows에서는 서명되지 않았거나 새로 게시된 앱에 평판 경고가 나타날 수 있습니다.

## 소스에서 실행

Node.js ^22.19.0 또는 24 이상과 pnpm 11.7.0을 설치한 뒤 다음을 실행합니다.

    git clone https://github.com/flaqai/open-deepseek-harness-desktop.git
    cd open-deepseek-harness-desktop
    pnpm install
    pnpm run build
    pnpm run dev:desktop

Web만 실행하려면 pnpm dsh web을 사용합니다. 소스 Web은 현재 DSH_HOME(미설정 시 일반적으로 ~/.dsh)을 사용하며 설치형 Desktop은 첫 실행에서 선택한 디렉터리를 사용합니다.

## 보안, 커뮤니티 및 라이선스

Renderer는 Node 통합을 비활성화하고 context isolation과 Chromium sandbox를 활성화합니다. 탐색은 정확한 Harness loopback origin으로 제한되며 임의 명령, 파일 또는 URL을 위한 범용 bridge를 제공하지 않습니다. API Key는 Harness 자격 증명 서비스를 사용하세요.

- [사용자 가이드](docs/user/guide/index.md), [플러그인 가이드](docs/user/develop/framework/index.md), [Skill 가이드](docs/subsystems/skills.md)
- 버그 및 제안: [GitHub Issues](https://github.com/flaqai/open-deepseek-harness-desktop/issues)
- 업스트림: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Open DeepSeek Harness Desktop는 [MIT License](LICENSE)로 제공됩니다. 타사 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요.

## Friends

- [DSHFind](https://dshfind.com/zh) — DeepSeek Harness 중국어 학습 및 공유 커뮤니티.
