const DEFAULT_NOTION_VERSION = '2022-06-28';

function readBoolean(name, fallback = false) {
  const value = process.env[name];

  if (value == null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function readNumber(name, fallback) {
  const value = process.env[name];

  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readList(name) {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readOptionalJson(name) {
  const raw = process.env[name];

  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} must be valid JSON: ${error.message}`);
  }
}

function readStringMap(name) {
  const parsed = readOptionalJson(name);

  if (parsed == null) {
    return {};
  }

  if (Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${name} must be a JSON object.`);
  }

  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, value]) => {
        if (typeof value !== 'string') {
          throw new Error(`${name} values must be strings.`);
        }

        return [key.trim(), value.trim()];
      })
      .filter(([key, value]) => key && value),
  );
}

function parseRepos() {
  const repositories = readList('GITHUB_REPOSITORIES');

  return repositories.map((repo) => {
    const [owner, name] = repo.split('/').map((part) => part?.trim());

    if (!owner || !name) {
      throw new Error(`Invalid GitHub repository "${repo}". Use owner/repo.`);
    }

    return {
      key: `${owner}/${name}`,
      owner,
      name,
    };
  });
}

export function loadConfig() {
  const githubRepos = parseRepos();
  const notionToken = process.env.NOTION_TOKEN ?? '';
  const notionDatabaseId = process.env.NOTION_DATABASE_ID ?? '';
  const channelId = process.env.DISCORD_CHANNEL_ID ?? '';

  return {
    app: {
      timezone: process.env.APP_TIMEZONE || 'Asia/Seoul',
      dataDir: process.env.DATA_DIR || './data',
    },
    discord: {
      token: process.env.DISCORD_TOKEN ?? '',
      clientId: process.env.DISCORD_CLIENT_ID ?? '',
      guildId: process.env.DISCORD_GUILD_ID ?? '',
      channelId,
      notionChannelId: process.env.DISCORD_NOTION_CHANNEL_ID || channelId,
      githubChannelId: process.env.DISCORD_GITHUB_CHANNEL_ID || channelId,
      mentionOnNotion: process.env.DISCORD_MENTION_ON_NOTION ?? '',
      mentionOnGithub: process.env.DISCORD_MENTION_ON_GITHUB ?? '',
      notionAssigneeMentions: readStringMap('DISCORD_NOTION_ASSIGNEE_MENTIONS_JSON'),
      githubReviewerMentions: readStringMap('DISCORD_GITHUB_REVIEWER_MENTIONS_JSON'),
      githubIssueAssigneeMentions: readStringMap('DISCORD_GITHUB_ISSUE_ASSIGNEE_MENTIONS_JSON'),
      notifyErrors: readBoolean('DISCORD_NOTIFY_ERRORS', true),
    },
    notion: {
      enabled: Boolean(notionToken && notionDatabaseId),
      token: notionToken,
      databaseId: notionDatabaseId,
      apiVersion: process.env.NOTION_VERSION || DEFAULT_NOTION_VERSION,
      pollIntervalMs: readNumber('NOTION_POLL_INTERVAL_MS', 60_000),
      notifyExistingOnStart: readBoolean('NOTION_NOTIFY_EXISTING_ON_START', false),
      notifyRemoved: readBoolean('NOTION_NOTIFY_REMOVED', false),
      titleProperty: process.env.NOTION_TITLE_PROPERTY || '',
      statusProperty: process.env.NOTION_STATUS_PROPERTY || '',
      assigneeProperty: process.env.NOTION_ASSIGNEE_PROPERTY || '',
      dueDateProperty: process.env.NOTION_DUE_DATE_PROPERTY || '',
      priorityProperty: process.env.NOTION_PRIORITY_PROPERTY || '',
      queryFilter: readOptionalJson('NOTION_QUERY_FILTER_JSON'),
      querySorts: readOptionalJson('NOTION_QUERY_SORTS_JSON'),
      maxPages: readNumber('NOTION_MAX_PAGES', 250),
    },
    github: {
      enabled: githubRepos.length > 0,
      token: process.env.GITHUB_TOKEN ?? '',
      repositories: githubRepos,
      pollIntervalMs: readNumber('GITHUB_POLL_INTERVAL_MS', 60_000),
      notifyExistingOnStart: readBoolean('GITHUB_NOTIFY_EXISTING_ON_START', false),
      notifyPrUpdates: readBoolean('GITHUB_NOTIFY_PR_UPDATES', true),
      notifyIssueUpdates: readBoolean('GITHUB_NOTIFY_ISSUE_UPDATES', true),
      watchIssues: readBoolean('GITHUB_WATCH_ISSUES', true),
      perPage: readNumber('GITHUB_PER_PAGE', 50),
    },
  };
}

export function validateConfig(config, { forCommandRegistration = false } = {}) {
  const errors = [];
  const warnings = [];

  if (!config.discord.token) {
    errors.push('DISCORD_TOKEN is required.');
  }

  if (!config.discord.clientId) {
    errors.push('DISCORD_CLIENT_ID is required.');
  }

  if (!forCommandRegistration && !config.discord.channelId) {
    errors.push('DISCORD_CHANNEL_ID is required.');
  }

  if (!config.notion.enabled) {
    warnings.push('Notion watcher is disabled. Set NOTION_TOKEN and NOTION_DATABASE_ID to enable it.');
  }

  if (!config.github.enabled) {
    warnings.push('GitHub watcher is disabled. Set GITHUB_REPOSITORIES to enable it.');
  }

  if (config.notion.pollIntervalMs < 15_000) {
    warnings.push('NOTION_POLL_INTERVAL_MS is very low. Notion API rate limits may be hit.');
  }

  if (config.github.pollIntervalMs < 15_000) {
    warnings.push('GITHUB_POLL_INTERVAL_MS is very low. GitHub API rate limits may be hit.');
  }

  return { errors, warnings };
}
