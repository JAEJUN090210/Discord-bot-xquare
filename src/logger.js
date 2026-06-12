function stamp() {
  return new Date().toISOString();
}

export const logger = {
  info(message, ...args) {
    console.log(`[${stamp()}] [info] ${message}`, ...args);
  },
  warn(message, ...args) {
    console.warn(`[${stamp()}] [warn] ${message}`, ...args);
  },
  error(message, ...args) {
    console.error(`[${stamp()}] [error] ${message}`, ...args);
  },
};
