require('dotenv').config();

import readline from 'readline';
import fetch, { RequestInit } from 'node-fetch';
import puppeteer from 'puppeteer';
import crypto from 'crypto';
import IBAN from 'iban';
import ProgressBar from 'progress';
import formatDate from 'date-fns/format/index.js';
import isAfter from 'date-fns/isAfter/index.js';
import {
  TriodosTransactionRaw,
  readConfig,
  toDate,
  triodosToJSON,
  writeConfig,
} from './utils';

const ignoreIBANs: string[] = [];

const LOGIN_URL =
  'https://bankieren.triodos.nl/ib-seam/login.seam?loginType=digipass&locale=nl_NL';

const { YNAB_ACCESS_TOKEN, IDENTIFIER_ID } = process.env;

if (!IDENTIFIER_ID) {
  throw new Error('No IDENTIFIER_ID found!');
}

const createYnabApi = (accessToken: string) => async <ReturnType>(
  path: string,
  options: RequestInit | undefined = undefined
): Promise<ReturnType> => {
  const response = await fetch(
    `https://api.youneedabudget.com/v1${path}?access_token=${accessToken}`,
    options
  );

  const { data, error } = await response.json();

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

const ynab = createYnabApi(YNAB_ACCESS_TOKEN);

const ask = (question: string): Promise<string> =>
  new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, answer => {
      resolve(answer);
      rl.close();
    });
  });

export type TriodosTransaction = {
  date: Date;
  payee: string;
  type: 'inflow' | 'outflow';
  amount: number;
  description: string;
  iban: string | null;
};

export type YNABTransaction = {
  account_id: string;
  date: string;
  payee_name: string;
  amount: number | null;
  memo: string | null;
  approved: boolean;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  import_id: string;
};

export type YNABAccount = {
  id: string;
  name: string;
  note: string;
};

export type YNABBudget = {
  id: string;
  name: string;
};

const generateImportId = (transaction: TriodosTransaction) => {
  const shasum = crypto.createHash('md5');
  const prefix = 'v1';

  shasum.update(
    [
      prefix,
      transaction.payee,
      transaction.type,
      transaction.amount,
      transaction.description,
      transaction.iban,
    ].join('')
  );

  return shasum.digest('hex');
};

type TriodosTransactionRawKey = keyof TriodosTransactionRaw;

const toYnabTransaction = (account: YNABAccount) => (
  transaction: TriodosTransaction
): YNABTransaction => ({
  account_id: account.id,
  date: formatDate(new Date(transaction.date), 'yyyy-MM-dd'),
  payee_name: transaction.payee,
  amount:
    transaction.type === 'inflow' ? transaction.amount : -transaction.amount,
  memo: transaction.description
    ? transaction.description.substring(0, 200)
    : null,
  approved: false,
  cleared: 'cleared', // cleared, uncleared, reconciled
  import_id: generateImportId(transaction),
});

const triodosLogin = async () => {
  const browser = await puppeteer.launch();

  const page = await browser.newPage();
  page.setViewport({ width: 1024, height: 768 });

  page.screenshot({ path: './page.png' });

  await page.goto(LOGIN_URL);

  page.screenshot({ path: './login.png' });

  const loginWithIdentifier = async (id: string) =>
    page.evaluate((id: string) => {
      (document.querySelectorAll(
        '[name=frm_gebruikersnummer_radio]'
      )[1] as HTMLInputElement).click();

      const input = document.querySelectorAll(
        '.defInput'
      )[1] as HTMLInputElement;

      input.value = id;

      const loginButton = document.querySelector(
        'button.btnArrowItem'
      ) as HTMLButtonElement;

      if (loginButton) {
        loginButton.click();
      }

      return Promise.resolve();
    }, id);

  const enterAccessCode = async (accessCode: string) => {
    await page.evaluate((accessCode: string) => {
      const element = document.querySelector('.smallInput') as HTMLInputElement;

      element.value = accessCode;

      return Promise.resolve();
    }, accessCode);

    return async () =>
      await page.evaluate(() => {
        (document?.querySelector(
          'button.btnItem'
        ) as HTMLButtonElement)?.click();

        return Promise.resolve();
      });
  };

  page.on('console', msg => {
    for (let i = 0; i < msg.args().length; ++i)
      console.log(`PAGE: ${i}: ${msg.args()[i]}`);
  });

  const downloadTransactions = async (
    iban: string,
    lastImportDate: Date
  ): Promise<TriodosTransaction[]> => {
    await page.goto('https://bankieren.triodos.nl/ib-seam/pages/home.seam');

    const formattedIban = IBAN.printFormat(iban);

    console.log(`Starting download for ${formattedIban}..`);

    await page.screenshot({ path: `step-0.png` });

    await page.evaluate(async (formattedIban: string) => {
      const link = Array.from(document.querySelectorAll('a')).filter(
        a => a?.textContent?.trim() === formattedIban
      )[0];

      await link.click();
    }, formattedIban);

    await page.screenshot({ path: `step-1.png` });
    await waitForPageChange();

    await page.screenshot({ path: `step-2.png` });

    const transactions: TriodosTransactionRaw[] = [];

    const rows = Array.from(await page.$$('tbody.rf-dt-b tr'));

    const rows2 = [];
    for (const row of rows) {
      const dateValue = (await row.$eval('td', (node: Element) =>
        node?.textContent?.trim()
      )) as string;

      const date = toDate(dateValue);

      if (isAfter(date, lastImportDate)) {
        rows2.push(row);
      }
    }

    const bar = new ProgressBar(
      'downloading transactions [:bar] :percent :etas',
      {
        complete: '=',
        incomplete: ' ',
        width: 30,
        total: rows2.length,
      }
    );

    for (const row of rows2) {
      const link = await row.$('.detailItem a');
      await link?.click();

      const modal = await page.waitFor('.modalPanel .formView');

      const labels = (await modal.$$eval('.labelItem', (nodes: Element[]) =>
        nodes.map((node: Element) => node?.textContent?.trim())
      )) as TriodosTransactionRawKey[];

      const values = (await modal.$$eval('.dataItem', (nodes: Element[]) =>
        nodes.map((node: Element) => node?.textContent?.trim())
      )) as string[];

      const transaction = labels.reduce((acc, label, index: number) => {
        return {
          ...acc,
          [label]: values[index],
        };
      }, {}) as TriodosTransactionRaw;

      transactions.push(transaction);

      const closeButton = await page.$('.butItemClose .btnItem');

      if (closeButton) {
        await closeButton.click();
      }

      await modal.evaluate((modal: Element) =>
        modal?.parentElement?.removeChild(modal)
      );

      bar.tick();
    }

    return transactions.map(transaction => triodosToJSON(transaction));
  };

  const waitForPageChange = () =>
    new Promise(resolve => {
      browser.on('targetchanged', resolve);
    });

  const endSession = async () => browser.close();

  return {
    loginWithIdentifier,
    enterAccessCode,
    endSession,
    downloadTransactions,
    waitForPageChange,
  };
};

const main = async () => {
  const {
    loginWithIdentifier,
    downloadTransactions,
    enterAccessCode,
    endSession,
    waitForPageChange,
  } = await triodosLogin();

  const config = await readConfig();

  await loginWithIdentifier(IDENTIFIER_ID);
  console.log('Not logged in yet!');
  await waitForPageChange();

  const accessCode = await ask('Access code identifier: ');

  const loginWithAccessCode = await enterAccessCode(accessCode);

  await loginWithAccessCode();
  await waitForPageChange();

  console.log('Fetching budgets..');
  const { budgets } = await ynab<{ budgets: YNABBudget[] }>('/budgets');

  for (const budget of budgets) {
    console.log(`-- Fetching accounts for ${budget.name}..`);

    const { accounts } = await ynab<{ accounts: YNABAccount[] }>(
      `/budgets/${budget.id}/accounts`
    );

    for (const account of accounts) {
      if (
        !account.note ||
        !account.note.includes('TRIO') ||
        !IBAN.isValid(account.note)
      ) {
        continue;
      }

      const formattedIban = IBAN.electronicFormat(account.note);

      if (ignoreIBANs.includes(formattedIban)) {
        console.log('---- Ignore IBAN ', formattedIban);
        continue;
      }

      console.log(
        `---- Fetching transactions for ${account.name} from ${formattedIban}..`
      );

      const transactions = await downloadTransactions(
        formattedIban,
        config.lastImportDate
      );

      const createYnabTransaction = toYnabTransaction(account);
      const ynabTransactions = transactions.map(transaction =>
        createYnabTransaction(transaction)
      );

      console.log('---- Sending transactions to YNAB..');

      const body = JSON.stringify({
        transactions: ynabTransactions,
      });

      try {
        await ynab(`/budgets/${budget.id}/transactions`, {
          method: 'post',
          body,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (e) {
        console.log(e);
      }
    }

    await writeConfig(config);

    console.log('All done!');
  }

  await endSession();
};

(async () => {
  console.log('start');
  await main();
})();
