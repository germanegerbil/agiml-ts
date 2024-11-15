import fs from 'fs';
export { resolve } from 'path';

export const str = (obj: object) => {
  return JSON.stringify(obj, null, 2);
};

const TEXT_FILE_EXTENSIONS = [
  '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', 
  '.css', '.scss', '.html', '.xml', '.yml', '.yaml', 
  '.env', '.config', '.agiml', '.log'
];

export const load = (filePath: string): string | Buffer => {
  const ext = filePath.toLowerCase().split('.').pop();
  const isTextFile = ext ? TEXT_FILE_EXTENSIONS.includes(`.${ext}`) : false;
  
  return isTextFile 
    ? fs.readFileSync(filePath, 'utf-8')
    : fs.readFileSync(filePath);
};

export const save = fs.writeFileSync;

export const log = (
  item: any,
  moduleId?: string,
  level = 'info',
  showOnProd = false
) => {
  if (process.env.PRODUCTION && !showOnProd) return;

  const loggers = {
    error: console.error,
    warn: console.warn,
    log: console.log,
  };

  const logger = loggers[level] || console.log;

  const appId = process.env.DEBUG_APP_ID || 'agiml-ts';
  const slug = `[${appId}@${moduleId}]`;

  if (
    typeof item === 'string' ||
    typeof item === 'number' ||
    typeof item === 'boolean' ||
    typeof item === 'undefined'
  )
    logger(slug, item);
  else logger(slug, str(item));
};