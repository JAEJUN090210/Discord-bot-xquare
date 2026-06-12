import { EmbedBuilder } from 'discord.js';
import { compactUrl, formatDate, formatList, truncate } from '../utils/format.js';

const COLORS = {
  notionCreated: 0x2ecc71,
  notionUpdated: 0xf1c40f,
  notionRemoved: 0xe67e22,
  githubOpened: 0x3498db,
  githubUpdated: 0x9b59b6,
  githubMerged: 0x2ecc71,
  githubClosed: 0xe74c3c,
  error: 0xe74c3c,
  info: 0x95a5a6,
};

export class DiscordNotifier {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.channels = new Map();
  }

  async prepareChannels() {
    const channelIds = new Set([this.config.discord.channelId].filter(Boolean));

    if (this.config.notion.enabled) {
      channelIds.add(this.config.discord.notionChannelId);
    }

    if (this.config.github.enabled) {
      channelIds.add(this.config.discord.githubChannelId);
    }

    await Promise.all([...channelIds].map((channelId) => this.getChannel(channelId)));
  }

  async getChannel(channelId = this.config.discord.channelId) {
    const targetChannelId = channelId || this.config.discord.channelId;

    if (this.channels.has(targetChannelId)) {
      return this.channels.get(targetChannelId);
    }

    const channel = await this.client.channels.fetch(targetChannelId);

    if (!channel?.isTextBased()) {
      throw new Error(`Discord channel ${targetChannelId} must point to a text based channel.`);
    }

    this.channels.set(targetChannelId, channel);

    return channel;
  }

  async sendEvent(event) {
    if (event.type.startsWith('notion_')) {
      return this.sendNotionEvent(event);
    }

    if (event.type.startsWith('github_')) {
      return this.sendGithubEvent(event);
    }

    return undefined;
  }

  async sendNotionEvent(event) {
    const channel = await this.getChannel(this.config.discord.notionChannelId);
    const embed = createNotionEmbed(event, this.config.app.timezone);
    const content = resolveNotionMention(event, this.config) || undefined;

    return channel.send({
      content,
      embeds: [embed],
      allowedMentions: { parse: ['roles', 'users', 'everyone'] },
    });
  }

  async sendGithubEvent(event) {
    const channel = await this.getChannel(this.config.discord.githubChannelId);
    const embed = createGithubEmbed(event, this.config.app.timezone);
    const content = resolveGithubMention(event, this.config) || undefined;

    return channel.send({
      content,
      embeds: [embed],
      allowedMentions: { parse: ['roles', 'users', 'everyone'] },
    });
  }

  async sendError(source, error) {
    if (!this.config.discord.notifyErrors) {
      return undefined;
    }

    const channelId =
      source === 'notion'
        ? this.config.discord.notionChannelId
        : source === 'github'
          ? this.config.discord.githubChannelId
          : this.config.discord.channelId;
    const channel = await this.getChannel(channelId);
    const embed = new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle(`알림 봇 오류: ${source}`)
      .setDescription(truncate(error.stack || error.message || String(error), 3800))
      .setTimestamp(new Date());

    return channel.send({ embeds: [embed] });
  }

  async sendTestAlert() {
    const channel = await this.getChannel();
    const embed = new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('XQUARE 알림 봇 테스트')
      .setDescription('Discord 채널 연결이 정상입니다.')
      .setTimestamp(new Date());

    return channel.send({ embeds: [embed] });
  }
}

function resolveNotionMention(event, config) {
  if (event.type === 'notion_task_created') {
    const major = event.snapshot?.highlights?.major ?? event.snapshot?.properties?.[config.notion.majorProperty];
    const majorMention = resolveMappedMention(major, config.discord.notionMajorMentions);

    if (majorMention) {
      return majorMention;
    }
  }

  return config.discord.mentionOnNotion;
}

function resolveGithubMention(event, config) {
  const repoKey = event.repo?.key || event.snapshot?.repo || '';
  return resolveMappedMention(repoKey, config.discord.githubRepositoryMentions) || config.discord.mentionOnGithub;
}

function resolveMappedMention(value, mentionMap) {
  const values = Array.isArray(value) ? value : [value];
  const mentions = values
    .map((item) => findMention(String(item ?? '').trim(), mentionMap))
    .filter(Boolean);

  return [...new Set(mentions)].join(' ');
}

function findMention(key, mentionMap) {
  if (!key) {
    return '';
  }

  if (mentionMap[key]) {
    return mentionMap[key];
  }

  const normalizedKey = key.toLowerCase();
  const matchedKey = Object.keys(mentionMap).find((candidate) => candidate.toLowerCase() === normalizedKey);

  return matchedKey ? mentionMap[matchedKey] : '';
}

function formatValue(value) {
  return Array.isArray(value) ? formatList(value) : String(value || '-');
}

function createNotionEmbed(event, timezone) {
  const { snapshot } = event;
  const isCreated = event.type === 'notion_task_created';
  const isRemoved = event.type === 'notion_task_removed';
  const titlePrefix = isCreated ? '새 Notion 태스크' : isRemoved ? 'Notion 태스크 제거됨' : 'Notion 태스크 변경';
  const color = isCreated ? COLORS.notionCreated : isRemoved ? COLORS.notionRemoved : COLORS.notionUpdated;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${titlePrefix}: ${truncate(snapshot.title, 180)}`)
    .setURL(snapshot.url)
    .addFields(
      { name: '상태', value: truncate(snapshot.highlights.status), inline: true },
      { name: '담당자', value: truncate(formatList(snapshot.highlights.assignees)), inline: true },
      { name: '마감일', value: truncate(snapshot.highlights.dueDate), inline: true },
      { name: '우선순위', value: truncate(snapshot.highlights.priority), inline: true },
      { name: '전공', value: truncate(formatValue(snapshot.highlights.major)), inline: true },
      { name: '마지막 수정', value: formatDate(snapshot.lastEditedTime, timezone), inline: true },
      { name: '링크', value: compactUrl(snapshot.url), inline: true },
    )
    .setTimestamp(new Date(snapshot.lastEditedTime || Date.now()));

  if (event.type === 'notion_task_updated') {
    const changeText = event.contentOnly
      ? '페이지 내용 또는 메타데이터가 변경되었습니다.'
      : event.changes
          .slice(0, 8)
          .map((change) => `**${change.key}**\n${truncate(change.before, 220)} → ${truncate(change.after, 220)}`)
          .join('\n\n');

    embed.setDescription(truncate(changeText, 3900));
  }

  return embed;
}

function createGithubEmbed(event, timezone) {
  const { snapshot, repo } = event;
  const meta = githubEventMeta(event.type);
  const embed = new EmbedBuilder()
    .setColor(meta.color)
    .setTitle(`${meta.title}: ${repo.key} #${snapshot.number}`)
    .setURL(snapshot.url)
    .setDescription(truncate(snapshot.title, 500))
    .addFields(
      { name: '작성자', value: truncate(snapshot.author), inline: true },
      { name: '상태', value: truncate(snapshot.fields.draft === 'draft' ? `${snapshot.state} / draft` : snapshot.state), inline: true },
      { name: '브랜치', value: truncate(`${snapshot.fields.head} → ${snapshot.fields.base}`), inline: true },
      { name: '라벨', value: truncate(formatList(snapshot.fields.labels)), inline: true },
      { name: '담당자', value: truncate(formatList(snapshot.fields.assignees)), inline: true },
      { name: '리뷰어', value: truncate(formatList(snapshot.fields.reviewers)), inline: true },
      { name: '업데이트', value: formatDate(snapshot.updatedAt, timezone), inline: true },
      { name: '링크', value: compactUrl(snapshot.url), inline: true },
    )
    .setTimestamp(new Date(snapshot.updatedAt || Date.now()));

  if (event.changes?.length) {
    embed.addFields({
      name: '변경사항',
      value: truncate(
        event.changes
          .slice(0, 8)
          .map((change) => `**${change.key}**: ${truncate(change.before, 180)} → ${truncate(change.after, 180)}`)
          .join('\n'),
        1000,
      ),
    });
  }

  return embed;
}

function githubEventMeta(type) {
  switch (type) {
    case 'github_pr_opened':
      return { title: '새 PR', color: COLORS.githubOpened };
    case 'github_pr_merged':
      return { title: 'PR 머지됨', color: COLORS.githubMerged };
    case 'github_pr_closed':
      return { title: 'PR 닫힘', color: COLORS.githubClosed };
    case 'github_pr_reopened':
      return { title: 'PR 다시 열림', color: COLORS.githubOpened };
    case 'github_pr_ready_for_review':
      return { title: 'PR 리뷰 준비됨', color: COLORS.githubOpened };
    case 'github_pr_converted_to_draft':
      return { title: 'PR Draft 전환', color: COLORS.githubUpdated };
    default:
      return { title: 'PR 변경', color: COLORS.githubUpdated };
  }
}
