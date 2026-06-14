# XQUARE Discord Bot

Notion 태스크 데이터베이스와 GitHub PR 변동을 감시해서 Discord 채널에 알려주는 봇입니다.

## 기능

- Notion 데이터베이스에 새 태스크가 추가되면 Discord 알림 전송
- Notion 태스크 속성 변경 감지
- Notion 페이지 내용만 수정되어도 `last_edited_time` 기반으로 변경 알림
- GitHub 저장소의 새 PR 감지
- PR 제목, 상태, draft 여부, 라벨, 담당자, 리뷰어, base/head 브랜치 변경 감지
- Discord slash command 지원
  - `/ping`: 봇 응답 확인
  - `/status`: Notion/GitHub 감시 상태 확인
  - `/sync`: 수동 동기화 실행
  - `/test-alert`: 알림 채널 테스트
- 첫 실행 시 기존 항목을 조용히 기준 상태로 저장해서 알림 폭주 방지
- 상태는 `data/state.json`에 저장

## 준비

1. Discord Developer Portal에서 Bot을 만들고 토큰을 발급합니다.
2. Bot 권한으로 `Send Messages`, `Embed Links`, `Use Slash Commands`를 부여합니다.
3. Notion Integration을 만들고 태스크 데이터베이스에 integration을 초대합니다.
4. GitHub private repository를 감시하려면 fine-grained token 또는 classic PAT를 준비합니다.

## 설치

```powershell
bun.cmd install
```

PowerShell에서 `bun`이 실행 정책 오류를 내면 `bun.cmd`를 사용하세요. 이 프로젝트는 `bunfig.toml`에서 `copyfile` 설치 방식을 고정합니다. Windows/OneDrive 환경에서 Bun hardlink 설치가 런타임 import 오류를 만드는 경우가 있어서입니다.

## 환경 변수

`.env.example`을 복사해서 `.env`를 만들고 값을 채웁니다.

```powershell
Copy-Item .env.example .env
```

필수 값:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_CHANNEL_ID`

Notion 알림을 쓰려면:

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`

GitHub PR 알림을 쓰려면:

- `GITHUB_REPOSITORIES=owner/repo,owner/another-repo`
- private repository라면 `GITHUB_TOKEN`

알림 채널과 멘션을 나누고 싶다면:

```env
DISCORD_NOTION_CHANNEL_ID=NOTION_CHANNEL_ID
DISCORD_GITHUB_CHANNEL_ID=GITHUB_CHANNEL_ID

NOTION_ASSIGNEE_PROPERTY=assign
DISCORD_NOTION_ASSIGNEE_MENTIONS_JSON={"홍길동":"<@USER_ID>","김철수":"<@&ROLE_ID>"}
DISCORD_GITHUB_REVIEWER_MENTIONS_JSON={"github-login":"<@USER_ID>","another-login":"<@&ROLE_ID>"}
```

`DISCORD_NOTION_CHANNEL_ID`, `DISCORD_GITHUB_CHANNEL_ID`가 비어 있으면 기존 `DISCORD_CHANNEL_ID`로 보냅니다. Notion 멘션은 새 태스크가 추가될 때 `NOTION_ASSIGNEE_PROPERTY`에 지정된 사람과 매칭되는 멘션을 사용하고, 매칭되는 값이 없으면 `DISCORD_MENTION_ON_NOTION`을 사용합니다. GitHub PR 멘션은 요청된 리뷰어의 GitHub 로그인과 매칭되는 멘션을 우선 사용하고, 없으면 `DISCORD_MENTION_ON_GITHUB`를 사용합니다.

## Discord 명령어 등록

테스트 서버에 빠르게 등록하려면 `DISCORD_GUILD_ID`를 채운 뒤 실행합니다.

```powershell
bun.cmd run register-commands
```

`DISCORD_GUILD_ID`를 비워두면 global command로 등록되며, Discord 반영까지 시간이 걸릴 수 있습니다.

## 실행

```powershell
bun.cmd run start
```

개발 중 자동 재시작:

```powershell
bun.cmd run dev
```

## Notion 설정 팁

속성 이름을 비워두면 봇이 데이터베이스 스키마를 보고 자동으로 추론합니다.

- title 타입 속성: 태스크 제목
- status 또는 select 타입 속성: 상태
- people 타입 속성: 담당자
- date 타입 속성: 마감일
- select/status 중 이름에 `priority`, `우선`, `중요`가 들어간 속성: 우선순위

정확히 지정하고 싶다면 `.env`에 아래처럼 넣으면 됩니다.

```env
NOTION_TITLE_PROPERTY=Name
NOTION_STATUS_PROPERTY=Status
NOTION_ASSIGNEE_PROPERTY=assign
NOTION_DUE_DATE_PROPERTY=Due
NOTION_PRIORITY_PROPERTY=Priority
```

## 운영 메모

- 첫 실행 기본값은 기존 Notion 태스크와 기존 GitHub PR을 알림으로 보내지 않습니다.
- 기존 항목도 모두 알림으로 받고 싶다면 `NOTION_NOTIFY_EXISTING_ON_START=true`, `GITHUB_NOTIFY_EXISTING_ON_START=true`로 설정하세요.
- 알림 상태를 초기화하고 다시 기준을 잡고 싶다면 봇을 끈 뒤 `data/state.json`을 삭제하면 됩니다.
- Notion API는 페이지 본문 diff를 직접 제공하지 않으므로, 본문만 바뀐 경우에는 "페이지 내용 또는 메타데이터 변경"으로 표시합니다.
