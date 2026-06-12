export function truncate(value, max = 1024) {
  const text = String(value ?? '');

  if (text.length <= max) {
    return text || '-';
  }

  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function formatDate(value, timezone = 'Asia/Seoul') {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatList(items, fallback = '-') {
  if (!Array.isArray(items) || items.length === 0) {
    return fallback;
  }

  return items.join(', ');
}

export function compactUrl(url) {
  if (!url) {
    return '-';
  }

  return `[열기](${url})`;
}
