"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = __importDefault(require("readline"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const crypto_1 = __importDefault(require("crypto"));
const iban_1 = __importDefault(require("iban"));
const progress_1 = __importDefault(require("progress"));
const index_js_1 = __importDefault(require("date-fns/format/index.js"));
const index_js_2 = __importDefault(require("date-fns/isAfter/index.js"));
const utils_1 = require("./utils");
const ignoreIBANs = ['NL20TRIO2044151294'];
const LOGIN_URL = 'https://bankieren.triodos.nl/ib-seam/login.seam?loginType=digipass&locale=nl_NL';
const { YNAB_ACCESS_TOKEN, IDENTIFIER_ID } = process.env;
const createYnabApi = (accessToken) => async (path, options = undefined) => {
    const response = await node_fetch_1.default(`https://api.youneedabudget.com/v1${path}?access_token=${accessToken}`, options);
    const { data, error } = await response.json();
    if (error) {
        throw new Error(error.message);
    }
    return data;
};
const ynab = createYnabApi(YNAB_ACCESS_TOKEN);
const ask = (question) => new Promise(resolve => {
    const rl = readline_1.default.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question(question, answer => {
        resolve(answer);
        rl.close();
    });
});
const generateImportId = (transaction) => {
    const shasum = crypto_1.default.createHash('md5');
    const prefix = 'v1';
    shasum.update([prefix, ...Object.values(transaction)].join(''));
    return shasum.digest('hex');
};
const toYnabTransaction = (account) => (transaction) => ({
    account_id: account.id,
    date: index_js_1.default(new Date(transaction.date), 'yyyy-MM-dd'),
    payee_name: transaction.payee,
    amount: transaction.type === 'inflow' ? transaction.amount : -transaction.amount,
    memo: transaction.description
        ? transaction.description.substring(0, 200)
        : null,
    approved: false,
    cleared: 'cleared',
    import_id: generateImportId(transaction),
});
const triodosLogin = async () => {
    const browser = await puppeteer_1.default.launch();
    const page = await browser.newPage();
    page.setViewport({ width: 1024, height: 768 });
    await page.goto(LOGIN_URL);
    const loginWithIdentifier = async (id) => page.evaluate((id) => {
        document
            .querySelectorAll('[name=frm_gebruikersnummer_radio]')[1]
            .dispatchEvent(new Event('click'));
        document.querySelectorAll('.defInput')[1].value = id;
        const loginButton = document.querySelector('button.btnArrowItem');
        if (loginButton) {
            loginButton.dispatchEvent(new Event('click'));
        }
        return Promise.resolve();
    }, id);
    const enterAccessCode = async (accessCode) => {
        await page.evaluate((accessCode) => {
            var _a;
            (_a = document === null || document === void 0 ? void 0 : document.querySelector('.smallInput')) === null || _a === void 0 ? void 0 : _a.value = accessCode;
            return Promise.resolve();
        }, accessCode);
        return async () => await page.evaluate(() => {
            var _a;
            (_a = document === null || document === void 0 ? void 0 : document.querySelector('button.btnItem')) === null || _a === void 0 ? void 0 : _a.dispatchEvent(new Event('click'));
            return Promise.resolve();
        });
    };
    page.on('console', msg => {
        for (let i = 0; i < msg.args().length; ++i)
            console.log(`PAGE: ${i}: ${msg.args()[i]}`);
    });
    const downloadTransactions = async (iban, lastImportDate) => {
        await page.goto('https://bankieren.triodos.nl/ib-seam/pages/home.seam');
        const formattedIban = iban_1.default.printFormat(iban);
        console.log(`Starting download for ${formattedIban}..`);
        await page.screenshot({ path: `step-0.png` });
        await page.evaluate(async (formattedIban) => {
            const link = Array.from(document.querySelectorAll('a')).filter(a => { var _a; return ((_a = a === null || a === void 0 ? void 0 : a.textContent) === null || _a === void 0 ? void 0 : _a.trim()) === formattedIban; })[0];
            await link.click();
        }, formattedIban);
        await page.screenshot({ path: `step-1.png` });
        await waitForPageChange();
        await page.screenshot({ path: `step-2.png` });
        const transactions = [];
        const rows = Array.from(await page.$$('tbody.rf-dt-b tr'));
        const rows2 = [];
        for (const row of rows) {
            const dateValue = await row.$eval('td', (node) => { var _a; return (_a = node === null || node === void 0 ? void 0 : node.textContent) === null || _a === void 0 ? void 0 : _a.trim(); });
            const date = utils_1.toDate(dateValue);
            if (index_js_2.default(date, lastImportDate)) {
                rows2.push(row);
            }
        }
        const bar = new progress_1.default('downloading transactions [:bar] :percent :etas', {
            complete: '=',
            incomplete: ' ',
            width: 30,
            total: rows2.length,
        });
        for (const row of rows2) {
            const link = await row.$('.detailItem a');
            await (link === null || link === void 0 ? void 0 : link.click());
            const modal = await page.waitFor('.modalPanel .formView');
            const labels = await modal.$$eval('.labelItem', (nodes) => nodes.map((node) => { var _a; return (_a = node === null || node === void 0 ? void 0 : node.textContent) === null || _a === void 0 ? void 0 : _a.trim(); }));
            const values = await modal.$$eval('.dataItem', (nodes) => nodes.map((node) => { var _a; return (_a = node === null || node === void 0 ? void 0 : node.textContent) === null || _a === void 0 ? void 0 : _a.trim(); }));
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
            await modal.evaluate((modal) => { var _a; return (_a = modal === null || modal === void 0 ? void 0 : modal.parentElement) === null || _a === void 0 ? void 0 : _a.removeChild(modal); });
            bar.tick();
        }
        return transactions.map(transaction => utils_1.triodosToJSON(transaction));
    };
    const waitForPageChange = () => new Promise(resolve => {
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
    const { loginWithIdentifier, downloadTransactions, enterAccessCode, endSession, waitForPageChange, } = await triodosLogin();
    const config = await utils_1.readConfig();
    await loginWithIdentifier(IDENTIFIER_ID);
    console.log('Not logged in yet!');
    await waitForPageChange();
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
            if (!account.note ||
                !account.note.includes('TRIO') ||
                !iban_1.default.isValid(account.note)) {
                continue;
            }
            const formattedIban = iban_1.default.electronicFormat(account.note);
            if (ignoreIBANs.includes(formattedIban)) {
                console.log('---- Ignore IBAN ', formattedIban);
                continue;
            }
            console.log(`---- Fetching transactions for ${account.name} from ${formattedIban}..`);
            const transactions = await downloadTransactions(formattedIban, config.lastImportDate);
            const createYnabTransaction = toYnabTransaction(account);
            const ynabTransactions = transactions.map(transaction => createYnabTransaction(transaction));
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
            }
            catch (e) {
                console.log(e);
            }
        }
        await utils_1.writeConfig(config);
        console.log('All done!');
    }
    await endSession();
};
main();
