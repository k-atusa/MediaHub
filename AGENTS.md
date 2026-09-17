# MediaHub AI Agent & Development Guidelines

이 문서는 MediaHub 프로젝트의 Git 브랜칭 전략, CI/CD 릴리즈 워크플로우, 그리고 AI 어시스턴트(Agent)가 따라야 할 개발 원칙을 정의합니다.

---

## 1. Git 브랜칭 전략 (Git Flow 변형)

MediaHub는 별도의 `feature` 브랜치를 생성하지 않는 간소화된 Git Flow 전략을 따릅니다.

```
       [develop] ────●────●────●────● (모든 개발 작업)
                       \             \
  (Release / Merge)     \             \
                         ▼             ▼
          [main] ──────────────────────● (자동 릴리즈 배포 트리거)
```

### 브랜치 규칙
1. **`develop` (기본 개발 브랜치)**:
   - **모든 개발 작업은 `develop` 브랜치에서만 수행합니다.**
   - 새 기능 추가, 버그 수정, 리팩토링, UI 개선 등 모든 커밋은 `develop`에 직접 반영합니다.
   - **`feature/*` 브랜치는 절대 따로 만들지 않습니다.**
2. **`main` (프로덕션 릴리즈 브랜치)**:
   - 프로덕션 배포 전용 브랜치입니다.
   - `main` 브랜치에 직접 코드를 작성하거나 커밋하지 않으며, `develop`에서 검증이 완료된 시점에 머지(또는 PR)합니다.
   - `main` 브랜치에 코드가 푸시되면 자동으로 GitHub Actions 릴리즈 워크플로우가 실행되어 멀티플랫폼 바이너리를 빌드 및 배포합니다.
3. **`hotfix` (긴급 수정)**:
   - 프로덕션에 긴급한 결함이 발생한 경우에만 `main`에서 분기하여 수정 후 `main`과 `develop` 양쪽에 반영합니다.

### AI Agent 필수 준수 사항
- 작업을 시작할 때 반드시 현재 브랜치가 `develop`인지 확인합니다 (`git branch --show-current`).
- `feature/` 접두사를 가진 브랜치를 임의로 생성하지 않습니다.
- 사용자의 명시적인 릴리즈/배포 요청이 있을 때만 `develop` -> `main` 머지를 진행합니다.

---

## 2. CI/CD 릴리즈 및 배포 파이프라인

- **워크플로우 파일**: [`.github/workflows/release.yml`](.github/workflows/release.yml)
- **트리거**:
  - `main` 브랜치로 코드가 `push`될 때
  - 버전 태그(`v*`)가 `push`될 때

### 자동 빌드 및 배포 대상 (5대 플랫폼)
Frontend(Next.js) 정적 번들이 임베딩(`//go:embed all:dist`)된 단일 실행 Go 바이너리를 크로스 컴파일하여 GitHub Release에 자동 첨부합니다.

| 플랫폼 | 아키텍처 | Go 환경 변수 | 배포 바이너리 파일명 규칙 |
| :--- | :--- | :--- | :--- |
| **Windows** | x86_64 | `GOOS=windows GOARCH=amd64` | `mediahub-server-{version}-windows-amd64.exe` |
| **Windows** | ARM64 | `GOOS=windows GOARCH=arm64` | `mediahub-server-{version}-windows-arm64.exe` |
| **macOS** | Apple Silicon (ARM64) | `GOOS=darwin GOARCH=arm64` | `mediahub-server-{version}-darwin-arm64` |
| **Linux** | x86_64 | `GOOS=linux GOARCH=amd64` | `mediahub-server-{version}-linux-amd64` |
| **Linux** | ARM64 | `GOOS=linux GOARCH=arm64` | `mediahub-server-{version}-linux-arm64` |

- 무결성 검증을 위해 5개 바이너리의 `checksums.txt` (SHA-256) 파일이 함께 릴리즈에 첨부됩니다.

---

## 3. 프로젝트 아키텍처 및 핵심 원칙

1. **로컬 실행 및 브라우저 제어 제한**:
   - **백엔드 바이너리 직접 실행 금지**: AI Agent는 `./server` 등의 백엔드 실행 바이너리를 직접 백그라운드로 실행하지 않습니다. 사용자가 직접 터미널에서 실행합니다.
   - **브라우저 서브에이전트 제어 금지**: `browser_subagent` 도구를 사용하지 않으며, 사용자가 직접 브라우저에서 확인하도록 안내합니다.
2. **빌드 명령**:
   - 프로젝트 루트의 `./build.sh`를 실행하여 프론트엔드 빌드(`frontend/out` -> `backend/dist`) 및 백엔드 Go 바이너리(`backend/server`) 컴파일을 한 번에 수행합니다.
3. **암호화 라이브러리 보존**:
   - `Bencrypt.js`, `Bencode.js`, `Opsec.js`는 MediaHub의 핵심 암호 엔진이므로 임의로 내부 로직을 변형하지 않습니다.
4. **종단간 암호화(E2EE) 및 스트리밍 파이프라인**:
   - 백엔드는 서비스 제공자가 악의적 스니퍼라는 상황을 가정한 Zero-Knowledge 모델을 따르므로, 암호화 키를 절대 수신하지 않고 복호화를 수행하지 않습니다.
   - 비디오 스트리밍은 브라우저 클라이언트 사이드 Service Worker(`sw.js`의 `/sw-stream/`)에서 암호화된 청크를 온더플라이(HTTP 206 Range)로 복호화하여 스트리밍하며, SW 미지원/장애 시 브라우저 내 인메모리 복호화(`fullDown`)로 폴백합니다.

