import { ApplicationCommandOptionType } from 'discord.js';

export const commandDefinitions = [
  {
    name: 'ping',
    description: '봇 응답 상태를 확인합니다.',
  },
  {
    name: 'status',
    description: 'Notion/GitHub PR/Issue 감시 상태를 확인합니다.',
  },
  {
    name: 'sync',
    description: 'Notion 또는 GitHub PR/Issue 동기화를 즉시 실행합니다.',
    options: [
      {
        name: 'target',
        description: '동기화 대상',
        type: ApplicationCommandOptionType.String,
        required: false,
        choices: [
          { name: 'all', value: 'all' },
          { name: 'notion', value: 'notion' },
          { name: 'github', value: 'github' },
        ],
      },
      {
        name: 'notify_existing',
        description: '첫 동기화 기준 저장 대상도 알림으로 보냅니다.',
        type: ApplicationCommandOptionType.Boolean,
        required: false,
      },
    ],
  },
  {
    name: 'test-alert',
    description: '설정된 알림 채널로 테스트 알림을 보냅니다.',
  },
];
