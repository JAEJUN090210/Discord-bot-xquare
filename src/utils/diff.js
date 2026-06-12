export function diffObjects(before = {}, after = {}) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];

  for (const key of keys) {
    const previousValue = before[key];
    const nextValue = after[key];

    if (JSON.stringify(previousValue) !== JSON.stringify(nextValue)) {
      changes.push({
        key,
        before: formatDiffValue(previousValue),
        after: formatDiffValue(nextValue),
      });
    }
  }

  return changes;
}

function formatDiffValue(value) {
  if (value == null || value === '') {
    return '-';
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(', ') : '-';
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}
