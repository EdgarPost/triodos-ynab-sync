import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import IBAN from 'iban';
import { TriodosTransaction } from './main';
import formatDate from 'date-fns/format/index.js';
import sub from 'date-fns/sub/index.js';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const toMoney = (x: string): number | null => {
  if (!x) {
    return null;
  }

  return Math.abs(Number(x.replace(/[^0-9]/g, ''))) * 10;
};

export const toDate = (date: string): Date => {
  const [d, m, y] = date.split('-');
  return new Date([y, m, d].join('-'));
};

export type TriodosTransactionRaw = {
  ['Bedrag bij']: string;
  ['Bedrag af']: string;
  Transactiedatum: string;
  Omschrijving: string;
  Naam: string;
  Tegenrekening: string;
};

export const triodosToJSON = (
  transaction: TriodosTransactionRaw
): TriodosTransaction => {
  const type = transaction['Bedrag bij'] ? 'inflow' : 'outflow';
  const date = toDate(transaction.Transactiedatum);
  const description = transaction.Omschrijving.split('\\')[0]
    .trim()
    .substring(0, 100);

  const payee = transaction.Naam || description;
  const amount = toMoney(transaction['Bedrag bij'] || transaction['Bedrag af']);
  const iban = IBAN.isValid(transaction.Tegenrekening)
    ? IBAN.printFormat(transaction.Tegenrekening)
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

export const createLastImportDate = (date = new Date(), days = 3) => {
  return formatDate(
    sub(date, {
      days,
    }),
    'yyyy-MM-dd'
  );
};

const configFilename = path.resolve(process.cwd(), '.sync-config');
const defaultConfig = {};

export type TriodosYNABConfig = {
  lastImportDate: Date;
};

export const readConfig = async (
  file = configFilename
): Promise<TriodosYNABConfig> => {
  let config;

  try {
    const contents = await readFile(file);
    config = JSON.parse(contents.toString());
  } catch (e) {
    config = defaultConfig;
  }

  if (!config.lastImportDate) {
    config.lastImportDate = createLastImportDate(new Date(), 60);
  }

  return {
    ...config,
    lastImportDate: new Date(config.lastImportDate),
  };
};

export const writeConfig = async (
  config: TriodosYNABConfig,
  file = configFilename
) =>
  writeFile(
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
