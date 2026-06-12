import { ActivityType, Client, Events, GatewayIntentBits } from 'discord.js';
import { loadConfig, validateConfig } from './config.js';
import { logger } from './logger.js';
import { JsonStore } from './state/jsonStore.js';
import { NotionWatcher } from './services/notion.js';
import { GitHubWatcher } from './services/github.js';
import { DiscordNotifier } from './discord/notifier.js';

const config = loadConfig();
const { errors, warnings } = validateConfig(config);

for (const warning of warnings) {
  logger.warn(warning);
}

if (errors.length > 0) {
  for (const error of errors) {
    logger.error(error);
  }

  process.exit(1);
}

const store = new JsonStore(config.app.dataDir);
await store.load();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const notifier = new DiscordNotifier(client, config);
const notionWatcher = config.notion.enabled ? new NotionWatcher(config, store) : null;
const githubWatcher = config.github.enabled ? new GitHubWatcher(config, store) : null;
const pollers = [];

client.once(Events.ClientReady, async (readyClient) => {
  logger.info(`Logged in as ${readyClient.user.tag}`);
  readyClient.user.setPresence({
    activities: [{ name: 'Notion tasks & GitHub PRs', type: ActivityType.Watching }],
    status: 'online',
  });
  await notifier.prepareChannels();
  logger.info(
    `Notification channels ready: default=${config.discord.channelId}, notion=${config.discord.notionChannelId}, github=${config.discord.githubChannelId}`,
  );

  if (notionWatcher) {
    startPoller('notion', config.notion.pollIntervalMs, () => pollNotion());
  }

  if (githubWatcher) {
    startPoller('github', config.github.pollIntervalMs, () => pollGithub());
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === 'ping') {
      await interaction.reply({
        content: `pong (${Math.max(0, Date.now() - interaction.createdTimestamp)}ms)`,
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'status') {
      await interaction.reply({
        content: createStatusMessage(),
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'test-alert') {
      await notifier.sendTestAlert();
      await interaction.reply({
        content: '테스트 알림을 전송했습니다.',
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === 'sync') {
      await interaction.deferReply({ ephemeral: true });

      const target = interaction.options.getString('target') ?? 'all';
      const notifyExisting = interaction.options.getBoolean('notify_existing') ?? false;
      const result = await pollSelected(target, { notifyExisting });

      await interaction.editReply(
        `${target} 동기화 완료. Notion ${result.notionEvents}건, GitHub ${result.githubEvents}건의 알림 이벤트가 있었습니다.`,
      );
    }
  } catch (error) {
    logger.error(`Command ${interaction.commandName} failed`, error);

    const message = `명령 처리 중 오류가 발생했습니다: ${error.message}`;

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

await client.login(config.discord.token);

function startPoller(name, intervalMs, job) {
  let running = false;
  let stopped = false;
  let timer;

  const run = async () => {
    if (stopped) {
      return;
    }

    if (running) {
      logger.warn(`${name} poll skipped because previous poll is still running.`);
      schedule();
      return;
    }

    running = true;

    try {
      await job();
    } catch (error) {
      logger.error(`${name} poll failed`, error);
      await notifier.sendError(name, error).catch((notifyError) => {
        logger.error(`Failed to send ${name} error notification`, notifyError);
      });
    } finally {
      running = false;
      schedule();
    }
  };

  const schedule = () => {
    timer = setTimeout(run, intervalMs);
  };

  pollers.push({
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  });

  setTimeout(run, 2_000);
}

async function pollSelected(target, options = {}) {
  const result = {
    notionEvents: 0,
    githubEvents: 0,
  };

  if ((target === 'all' || target === 'notion') && notionWatcher) {
    result.notionEvents = await pollNotion(options);
  }

  if ((target === 'all' || target === 'github') && githubWatcher) {
    result.githubEvents = await pollGithub(options);
  }

  return result;
}

async function pollNotion(options = {}) {
  const events = await notionWatcher.poll(options);
  await store.save();

  for (const event of events) {
    await notifier.sendEvent(event);
  }

  if (events.length > 0) {
    logger.info(`Notion poll emitted ${events.length} event(s).`);
  }

  return events.length;
}

async function pollGithub(options = {}) {
  const events = await githubWatcher.poll(options);
  await store.save();

  for (const event of events) {
    await notifier.sendEvent(event);
  }

  if (events.length > 0) {
    logger.info(`GitHub poll emitted ${events.length} event(s).`);
  }

  return events.length;
}

function createStatusMessage() {
  const state = store.getState();
  const notionCount = Object.keys(state.notion.pages ?? {}).length;
  const repoStates = Object.entries(state.github.repos ?? {});
  const prCount = repoStates.reduce((total, [, repoState]) => total + Object.keys(repoState.prs ?? {}).length, 0);
  const repos = config.github.repositories.map((repo) => repo.key).join(', ') || '-';

  return [
    '**XQUARE 알림 봇 상태**',
    `Discord 채널: 기본 <#${config.discord.channelId}> / Notion <#${config.discord.notionChannelId}> / GitHub <#${config.discord.githubChannelId}>`,
    `Notion: ${config.notion.enabled ? 'enabled' : 'disabled'} / 추적 태스크 ${notionCount}개 / 마지막 동기화 ${state.notion.lastPollAt ?? '-'}`,
    `GitHub: ${config.github.enabled ? 'enabled' : 'disabled'} / 저장소 ${repos} / 추적 PR ${prCount}개 / 마지막 동기화 ${state.github.lastPollAt ?? '-'}`,
  ].join('\n');
}

async function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down...`);

  for (const poller of pollers) {
    poller.stop();
  }

  await store.save().catch((error) => logger.error('Failed to save state during shutdown', error));
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
