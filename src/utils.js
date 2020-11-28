import IBAN from 'iban';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import formatDate from 'date-fns/format/index.js';
import sub from 'date-fns/sub/index.js';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const toMoney = x => {
  if (!x) {
    return null;
  }
  return Math.abs(Number(x.replace(/[^0-9]/g, ''))) * 10;
};

export const toDate = date => {
  const [d, m, y] = date.split('-');
  return new Date([y, m, d].join('-'));
};

export const triodosToJSON = triodos => {
  const type = triodos['Bedrag bij'] ? 'inflow' : 'outflow';
  const date = toDate(triodos.Transactiedatum);
  const description = triodos.Omschrijving.split('\\')[0]
    .trim()
    .substring(0, 100);

  const payee = triodos.Naam || description;
  const amount = toMoney(triodos['Bedrag bij'] || triodos['Bedrag af']);
  const iban = IBAN.isValid(triodos.Tegenrekening)
    ? IBAN.printFormat(triodos.Tegenrekening)
    : null;

  return {
    date,
    amount,
    type,
    payee,
    iban,
    description,
  };
};

export const createLastImportDate = (date = new Date()) => {
  return formatDate(
    sub(date, {
      days: 3,
    }),
    'yyyy-MM-dd'
  );
};

const configFilename = path.resolve(process.cwd(), '.sync-config');
const defaultConfig = {};

export const readConfig = async (file = configFilename) => {
  let config;

  try {
    const contents = await readFile(file);
    config = JSON.parse(contents);
  } catch (e) {
    config = defaultConfig;
  }

  if (!config.lastImportDate) {
    config.lastImportDate = createLastImportDate();
  }

  return {
    ...config,
    lastImportDate: new Date(config.lastImportDate),
  };
};

export const writeConfig = async (config, file = configFilename) => {
  return writeFile(
    file,
    JSON.stringify(
      {
        ...config,
        lastImportDate: createLastImportDate().toString(),
      },
      null,
      2
    )
  );
};
