import { createHash } from 'node:crypto';
import { diffObjects } from '../utils/diff.js';

export class GitHubWatcher {
  constructor(config, store) {
    this.config = config;
    this.store = store;
  }

  async poll({ notifyExisting = false } = {}) {
    const state = this.store.getState();
    const events = [];
    const now = new Date().toISOString();

    for (const repo of this.config.github.repositories) {
      const repoState = getRepoState(state, repo.key);
      const isFirstRun = !repoState.initialized;
      const pulls = await this.fetchPullRequests(repo);

      for (const listedPull of pulls) {
        const pull = await this.enrichPullRequestIfNeeded(repo, listedPull);
        const snapshot = createPullRequestSnapshot(repo, pull);
        const previous = repoState.prs[pull.number];

        if (!previous) {
          repoState.prs[pull.number] = snapshot;

          if (!isFirstRun || notifyExisting || this.config.github.notifyExistingOnStart) {
            events.push({
              type: 'github_pr_opened',
              repo,
              snapshot,
            });
          }

          continue;
        }

        if (previous.hash !== snapshot.hash) {
          repoState.prs[pull.number] = snapshot;

          if (this.config.github.notifyPrUpdates) {
            events.push({
              type: classifyPullRequestChange(previous, snapshot),
              repo,
              snapshot,
              previous,
              changes: diffObjects(previous.fields, snapshot.fields),
            });
          }
        }
      }

      repoState.initialized = true;
      repoState.lastPollAt = now;
    }

    state.github.lastPollAt = now;

    return events;
  }

  async fetchPullRequests(repo) {
    const response = await this.request(
      `/repos/${repo.owner}/${repo.name}/pulls?state=all&sort=updated&direction=desc&per_page=${this.config.github.perPage}`,
    );

    return response;
  }

  async enrichPullRequestIfNeeded(repo, pull) {
    if (pull.state !== 'closed' || Object.hasOwn(pull, 'merged_at')) {
      return pull;
    }

    return this.request(`/repos/${repo.owner}/${repo.name}/pulls/${pull.number}`);
  }

  async request(path) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'xquare-discord-bot',
    };

    if (this.config.github.token) {
      headers.Authorization = `Bearer ${this.config.github.token}`;
    }

    const response = await fetch(`https://api.github.com${path}`, { headers });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API ${response.status}: ${body}`);
    }

    return response.json();
  }
}

function getRepoState(state, repoKey) {
  if (!state.github.repos[repoKey]) {
    state.github.repos[repoKey] = {
      initialized: false,
      lastPollAt: null,
      prs: {},
    };
  }

  return state.github.repos[repoKey];
}

function createPullRequestSnapshot(repo, pull) {
  const fields = {
    title: pull.title,
    state: pull.state,
    draft: pull.draft ? 'draft' : 'ready',
    merged: pull.merged_at ? 'merged' : '',
    base: pull.base?.ref ?? '',
    head: pull.head?.ref ?? '',
    author: pull.user?.login ?? '',
    labels: pull.labels?.map((label) => label.name).sort() ?? [],
    assignees: pull.assignees?.map((user) => user.login).sort() ?? [],
    reviewers: pull.requested_reviewers?.map((user) => user.login).sort() ?? [],
  };
  const hash = createHash('sha256')
    .update(JSON.stringify(fields))
    .digest('hex');

  return {
    id: pull.id,
    repo: repo.key,
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    apiUrl: pull.url,
    state: pull.state,
    draft: Boolean(pull.draft),
    mergedAt: pull.merged_at,
    createdAt: pull.created_at,
    updatedAt: pull.updated_at,
    closedAt: pull.closed_at,
    author: pull.user?.login ?? '',
    fields,
    hash,
  };
}

function classifyPullRequestChange(previous, snapshot) {
  if (previous.fields.state !== snapshot.fields.state) {
    if (snapshot.fields.state === 'closed' && snapshot.fields.merged) {
      return 'github_pr_merged';
    }

    if (snapshot.fields.state === 'closed') {
      return 'github_pr_closed';
    }

    if (snapshot.fields.state === 'open') {
      return 'github_pr_reopened';
    }
  }

  if (previous.fields.draft === 'draft' && snapshot.fields.draft === 'ready') {
    return 'github_pr_ready_for_review';
  }

  if (previous.fields.draft === 'ready' && snapshot.fields.draft === 'draft') {
    return 'github_pr_converted_to_draft';
  }

  return 'github_pr_updated';
}
