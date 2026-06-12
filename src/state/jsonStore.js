import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const EMPTY_STATE = {
  version: 1,
  notion: {
    pages: {},
    initialized: false,
    lastPollAt: null,
  },
  github: {
    repos: {},
    lastPollAt: null,
  },
};

export class JsonStore {
  constructor(dataDir) {
    this.path = join(dataDir, 'state.json');
    this.state = structuredClone(EMPTY_STATE);
  }

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = mergeState(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    return this.state;
  }

  getState() {
    return this.state;
  }

  async save() {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.tmp`;
    const payload = `${JSON.stringify(this.state, null, 2)}\n`;

    await writeFile(tempPath, payload, 'utf8');
    await rename(tempPath, this.path);
  }
}

function mergeState(parsed) {
  return {
    ...structuredClone(EMPTY_STATE),
    ...parsed,
    notion: {
      ...EMPTY_STATE.notion,
      ...(parsed.notion ?? {}),
      pages: parsed.notion?.pages ?? {},
    },
    github: {
      ...EMPTY_STATE.github,
      ...(parsed.github ?? {}),
      repos: parsed.github?.repos ?? {},
    },
  };
}
