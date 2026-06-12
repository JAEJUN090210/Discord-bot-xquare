import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './discord/commands.js';
import { loadConfig, validateConfig } from './config.js';
import { logger } from './logger.js';

const config = loadConfig();
const { errors, warnings } = validateConfig(config, { forCommandRegistration: true });

for (const warning of warnings) {
  logger.warn(warning);
}

if (errors.length > 0) {
  for (const error of errors) {
    logger.error(error);
  }

  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(config.discord.token);
const route = config.discord.guildId
  ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
  : Routes.applicationCommands(config.discord.clientId);

logger.info(
  `Registering ${commandDefinitions.length} command(s) ${config.discord.guildId ? 'to guild' : 'globally'}...`,
);

await rest.put(route, { body: commandDefinitions });

logger.info('Discord commands registered.');
