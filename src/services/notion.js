import { createHash } from 'node:crypto';
import { diffObjects } from '../utils/diff.js';

export class NotionWatcher {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.schema = null;
  }

  async poll({ notifyExisting = false } = {}) {
    const state = this.store.getState();
    const notionState = state.notion;
    const database = await this.fetchDatabase();
    const schema = inferSchema(database, this.config.notion);
    const pages = await this.queryDatabase();
    const now = new Date().toISOString();
    const isFirstRun = !notionState.initialized;
    const seen = new Set();
    const events = [];

    for (const page of pages) {
      seen.add(page.id);

      const snapshot = createPageSnapshot(page, schema);
      const previous = notionState.pages[page.id];

      if (!previous) {
        notionState.pages[page.id] = {
          ...snapshot,
          firstSeenAt: now,
          active: true,
        };

        if (!isFirstRun || notifyExisting || this.config.notion.notifyExistingOnStart) {
          events.push({
            type: 'notion_task_created',
            snapshot,
            schema,
          });
        }

        continue;
      }

      const changed = previous.hash !== snapshot.hash || previous.lastEditedTime !== snapshot.lastEditedTime;

      if (changed) {
        const propertyChanges = diffObjects(previous.properties, snapshot.properties);

        notionState.pages[page.id] = {
          ...previous,
          ...snapshot,
          active: true,
        };

        events.push({
          type: 'notion_task_updated',
          snapshot,
          previous,
          schema,
          changes: propertyChanges,
          contentOnly: propertyChanges.length === 0,
        });
      } else if (!previous.active) {
        notionState.pages[page.id] = {
          ...previous,
          active: true,
        };
      }
    }

    if (this.config.notion.notifyRemoved && notionState.initialized) {
      for (const [pageId, previous] of Object.entries(notionState.pages)) {
        if (previous.active && !seen.has(pageId)) {
          notionState.pages[pageId] = {
            ...previous,
            active: false,
            removedAt: now,
          };

          events.push({
            type: 'notion_task_removed',
            snapshot: previous,
            schema,
          });
        }
      }
    }

    notionState.initialized = true;
    notionState.lastPollAt = now;
    notionState.schema = schema;

    return events;
  }

  async fetchDatabase() {
    if (this.schema) {
      return this.schema.database;
    }

    const database = await this.request(`/v1/databases/${this.config.notion.databaseId}`);
    this.schema = {
      database,
    };

    return database;
  }

  async queryDatabase() {
    const results = [];
    let cursor;

    do {
      const body = {
        page_size: Math.min(100, this.config.notion.maxPages - results.length),
      };

      if (cursor) {
        body.start_cursor = cursor;
      }

      if (this.config.notion.queryFilter) {
        body.filter = this.config.notion.queryFilter;
      }

      if (this.config.notion.querySorts) {
        body.sorts = this.config.notion.querySorts;
      } else {
        body.sorts = [{ timestamp: 'last_edited_time', direction: 'descending' }];
      }

      const response = await this.request(`/v1/databases/${this.config.notion.databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      results.push(...response.results);
      cursor = response.has_more && results.length < this.config.notion.maxPages ? response.next_cursor : undefined;
    } while (cursor);

    return results;
  }

  async request(path, init = {}) {
    const response = await fetch(`https://api.notion.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.notion.token}`,
        'Notion-Version': this.config.notion.apiVersion,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Notion API ${response.status}: ${body}`);
    }

    return response.json();
  }
}

function inferSchema(database, notionConfig) {
  const properties = database.properties ?? {};
  const entries = Object.entries(properties);

  const titleProperty = notionConfig.titleProperty || entries.find(([, prop]) => prop.type === 'title')?.[0] || 'Name';
  const statusProperty =
    notionConfig.statusProperty ||
    findByTypeOrName(entries, ['status'], ['status', 'state', '상태']) ||
    findByTypeOrName(entries, ['select'], ['status', 'state', '상태']);
  const assigneeProperty =
    notionConfig.assigneeProperty || findByTypeOrName(entries, ['people'], ['assignee', 'owner', '담당']);
  const dueDateProperty =
    notionConfig.dueDateProperty || findByTypeOrName(entries, ['date'], ['due', 'deadline', 'date', '마감', '기한']);
  const priorityProperty =
    notionConfig.priorityProperty ||
    findByTypeOrName(entries, ['select', 'status'], ['priority', 'importance', '우선', '중요']);

  return {
    databaseTitle: plainText(database.title),
    titleProperty,
    statusProperty,
    assigneeProperty,
    dueDateProperty,
    priorityProperty,
  };
}

function findByTypeOrName(entries, types, names) {
  const loweredNames = names.map((name) => name.toLowerCase());
  const byName = entries.find(([name, prop]) => {
    const lowered = name.toLowerCase();
    return types.includes(prop.type) && loweredNames.some((keyword) => lowered.includes(keyword));
  });

  if (byName) {
    return byName[0];
  }

  return entries.find(([, prop]) => types.includes(prop.type))?.[0] ?? '';
}

function createPageSnapshot(page, schema) {
  const properties = compactProperties(page.properties ?? {});
  const title = properties[schema.titleProperty] || page.id;
  const hash = createHash('sha256')
    .update(JSON.stringify(properties))
    .digest('hex');

  return {
    id: page.id,
    title,
    url: page.url,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    archived: page.archived,
    properties,
    hash,
    highlights: {
      status: schema.statusProperty ? properties[schema.statusProperty] : '',
      assignees: schema.assigneeProperty ? toArray(properties[schema.assigneeProperty]) : [],
      dueDate: schema.dueDateProperty ? properties[schema.dueDateProperty] : '',
      priority: schema.priorityProperty ? properties[schema.priorityProperty] : '',
    },
  };
}

function compactProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => [name, compactProperty(property)]),
  );
}

function compactProperty(property) {
  switch (property.type) {
    case 'title':
      return plainText(property.title);
    case 'rich_text':
      return plainText(property.rich_text);
    case 'number':
      return property.number ?? '';
    case 'select':
      return property.select?.name ?? '';
    case 'multi_select':
      return property.multi_select?.map((item) => item.name) ?? [];
    case 'status':
      return property.status?.name ?? '';
    case 'date':
      return property.date?.end ? `${property.date.start} ~ ${property.date.end}` : property.date?.start ?? '';
    case 'people':
      return property.people?.map((person) => person.name || person.id) ?? [];
    case 'checkbox':
      return property.checkbox ? 'true' : 'false';
    case 'url':
      return property.url ?? '';
    case 'email':
      return property.email ?? '';
    case 'phone_number':
      return property.phone_number ?? '';
    case 'relation':
      return property.relation?.map((item) => item.id) ?? [];
    case 'formula':
      return compactFormula(property.formula);
    case 'rollup':
      return compactRollup(property.rollup);
    case 'files':
      return property.files?.map((file) => file.name) ?? [];
    case 'created_time':
      return property.created_time ?? '';
    case 'created_by':
      return property.created_by?.name || property.created_by?.id || '';
    case 'last_edited_time':
      return property.last_edited_time ?? '';
    case 'last_edited_by':
      return property.last_edited_by?.name || property.last_edited_by?.id || '';
    default:
      return `[${property.type}]`;
  }
}

function compactFormula(formula) {
  if (!formula) {
    return '';
  }

  return formula[formula.type] ?? '';
}

function compactRollup(rollup) {
  if (!rollup) {
    return '';
  }

  if (rollup.type === 'array') {
    return rollup.array?.map(compactProperty) ?? [];
  }

  return rollup[rollup.type] ?? '';
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? '').join('');
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}
