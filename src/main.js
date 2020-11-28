import readline from 'readline';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import crypto from 'crypto';
import IBAN from 'iban';
import ProgressBar from 'progress';
import formatDate from 'date-fns/format/index.js';
import isAfter from 'date-fns/isAfter/index.js';
import { readConfig, toDate, triodosToJSON, writeConfig } from './utils.js';

const ignoreIBANs = ['NL20TRIO2044151294'];

const LOGIN_URL =
  'https://bankieren.triodos.nl/ib-seam/login.seam?loginType=digipass&locale=nl_NL';

const { YNAB_ACCESS_TOKEN, IDENTIFIER_ID } = process.env;

const createYnabApi = accessToken => async (path, options) => {
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

const ask = question =>
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

const generateImportId = transaction => {
  const shasum = crypto.createHash('md5');
  const prefix = 'v1';
  shasum.update([prefix, ...Object.values(transaction)].join(''));

  return shasum.digest('hex');
};

const toYnabTransaction = account => transaction => ({
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

  await page.goto(LOGIN_URL);

  const loginWithIdentifier = async id =>
    page.evaluate(id => {
      document.querySelectorAll('[name=frm_gebruikersnummer_radio]')[1].click();
      document.querySelectorAll('.defInput')[1].value = id;
      document.querySelector('button.btnArrowItem').click();

      return Promise.resolve();
    }, id);

  const enterAccessCode = async accessCode => {
    await page.evaluate(accessCode => {
      document.querySelector('.smallInput').value = accessCode;

      return Promise.resolve();
    }, accessCode);

    return async () =>
      await page.evaluate(() => {
        document.querySelector('button.btnItem').click();

        return Promise.resolve();
      });
  };

  page.on('console', msg => {
    for (let i = 0; i < msg.args().length; ++i)
      console.log(`PAGE: ${i}: ${msg.args()[i]}`);
  });

  const downloadTransactions = async (iban, lastImportDate) => {
    await page.goto('https://bankieren.triodos.nl/ib-seam/pages/home.seam');

    const formattedIban = IBAN.printFormat(iban);

    console.log(`Starting download for ${formattedIban}..`);

    await page.screenshot({ path: `step-0.png` });

    await page.evaluate(async formattedIban => {
      const link = Array.from(document.querySelectorAll('a')).filter(
        a => a.textContent.trim() === formattedIban
      )[0];

      await link.click();
    }, formattedIban);

    await page.screenshot({ path: `step-1.png` });
    await waitForPageChange();

    await page.screenshot({ path: `step-2.png` });

    const transactions = [];

    const rows = Array.from(await page.$$('tbody.rf-dt-b tr'));

    const rows2 = [];
    for (const row of rows) {
      const dateValue = await row.$eval('td', node => node.textContent.trim());
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
      await link.click();

      const modal = await page.waitFor('.modalPanel .formView');

      const labels = await modal.$$eval('.labelItem', nodes =>
        nodes.map(node => node.textContent.trim())
      );

      const values = await modal.$$eval('.dataItem', nodes =>
        nodes.map(node => node.textContent.trim())
      );

      const transaction = labels.reduce((acc, label, index) => {
        return {
          ...acc,
          [label]: values[index],
        };
      }, {});

      transactions.push(transaction);

      const closeButton = await page.$('.butItemClose .btnItem');

      if (closeButton) {
        await closeButton.click();
      }

      await modal.evaluate(modal => modal.parentElement.removeChild(modal));

      bar.tick();
    }

    return transactions.map(triodosToJSON);
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

(async () => {
  const {
    loginWithIdentifier,
    downloadTransactions,
    enterAccessCode,
    endSession,
    waitForPageChange,
  } = await triodosLogin();

  const config = await readConfig();

  await loginWithIdentifier(IDENTIFIER_ID);
  await waitForPageChange();

  console.log('Not logged in yet!');
  const accessCode = await ask('Access code identifier: ');

  const loginWithAccessCode = await enterAccessCode(accessCode);

  await loginWithAccessCode();
  await waitForPageChange();

  console.log('Fetching budgets..');
  const { budgets } = await ynab('/budgets');

  for (const budget of budgets) {
    console.log(`-- Fetching accounts for ${budget.name}..`);

    const { accounts } = await ynab(`/budgets/${budget.id}/accounts`);

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

      const ynabTransactions = transactions.map(toYnabTransaction(account));

      console.log('---- Sending transactions to YNAB..');

      const body = JSON.stringify({
        transactions: ynabTransactions,
      });

      try {
        const response = await ynab(`/budgets/${budget.id}/transactions`, {
          method: 'post',
          body,
          headers: { 'Content-Type': 'application/json' },
        });

        console.log('Done', response);
      } catch (e) {
        console.log(e);
      }

      await writeConfig(config);

      console.log('All done!');
    }
  }

  await endSession();
})();
