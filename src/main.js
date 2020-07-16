import fs from 'fs';
import path from 'path';
import util from 'util';
import readline from 'readline';
import fetch from 'node-fetch';
import puppeteer from 'puppeteer';
import parse from 'csv-parse';
import IBAN from 'iban';
import csvToJson from './csvToJson.js';

const __dirname = path.resolve();
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const readDir = util.promisify(fs.readdir);
const unlink = util.promisify(fs.unlink);
const parseCsv = util.promisify(parse);

const LOGIN_URL =
	'https://bankieren.triodos.nl/ib-seam/login.seam?loginType=digipass&locale=nl_NL';
const YNAB_ACCESS_TOKEN =
	'6c6f51f234e9ab7e2206d8aab7964572aabd5e50ad6952b5c9b08b3f1667b426';
const IDENTIFIER_ID = '61-1036532-9'; // Edgar

const createYnabApi = accessToken => async path => {
	const response = await fetch(
		`https://api.youneedabudget.com/v1${path}?access_token=${accessToken}`
	);
	const { data } = await response.json();

	return Object.values(data)[0];
};

const wait = ms =>
	new Promise(resolve => {
		setTimeout(resolve, ms);
	});

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

const createCamera = page => {
	let step = -1;

	return () => {
		step++;

		return page.screenshot({ path: `step-${step}.png` });
	};
};

const triodosLogin = async () => {
	const browser = await puppeteer.launch();

	const page = await browser.newPage();
	page.setViewport({ width: 1024, height: 768 });

	page.once('load', () => console.log('Page loaded!'));

	const makeSnapshot = createCamera(page);

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

	const downloadTransactions = async iban => {
		await page.goto(
			'https://bankieren.triodos.nl/ib-seam/pages/accountinformation/download/download.seam'
		);
		await makeSnapshot();

		const formattedIban = IBAN.electronicFormat(iban);

		console.log(`Starting download for ${formattedIban}..`);

		await page._client.send('Page.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: './tmp',
		});

		await page.evaluate(() => {
			document.querySelectorAll('input[type=radio]')[1].click();

			return Promise.resolve();
		});

		await wait(1000); // @todo: change to waitFor ?
		await makeSnapshot();

		await page.evaluate(findIban => {
			console.log(`Preparing CSV download for ${findIban}..`);

			const dropdown = document.querySelectorAll('select')[0];

			const index = Array.from(dropdown.querySelectorAll('option')).findIndex(
				option => {
					const formattedIban = option.textContent
						.split('-')[0]
						.replace(/[^a-z\d]/gi, '');

					return formattedIban === findIban;
				}
			);

			document.querySelectorAll('select')[0].selectedIndex = index;
			document.querySelectorAll('input[type=text]')[0].value = '01-01-2020';
			document.querySelectorAll('input[type=text]')[1].value = '15-07-2020';

			document.querySelector('.linkBottomUnit .btnItem').click();

			return Promise.resolve();
		}, formattedIban);

		await makeSnapshot();

		console.log(`Waiting for download to be ready..`);

		const waitForDownload = async () => {
			await page.evaluate(() => {
				document.querySelector('.lastUnit .btnItem').click();

				return Promise.resolve();
			});

			await makeSnapshot();

			const done = await page.evaluate(() => {
				const status = document
					.querySelector('.lastUnit .lookupList')
					.querySelectorAll('tbody tr')[0]
					.querySelectorAll('td')[3].textContent;

				return Promise.resolve(status === 'Verwerkt');
			});

			if (done) {
				console.log('Done!');
				return done;
			}

			console.log('Try again in 1 second!');

			await wait(1000);

			return waitForDownload();
		};

		await waitForDownload();

		await makeSnapshot();

		console.log(`Downloading CSV..`);

		await page.evaluate(() => {
			document
				.querySelector('.lastUnit .lookupList')
				.querySelector('tbody tr td a')
				.click();

			return Promise.resolve();
		});

		console.log(`Download complete..`);

		const getDownloadedContents = async () => {
			const downloadDir = path.resolve(__dirname, './tmp');

			// @todo clean tmp dir
			console.log('Read dir', downloadDir);
			const downloadedFiles = await readDir(downloadDir);
			console.log('files:', downloadedFiles);

			const csvFile = downloadedFiles.find(file => file.endsWith('.csv'));

			if (!csvFile) {
				await wait(100);
				return getDownloadedContents();
			}

			console.log('Found', csvFile);
			const filePath = path.resolve(downloadDir, csvFile);

			console.log('Read file', filePath);
			const contents = await readFile(filePath);

			console.log('Remove', filePath);
			await unlink(filePath);

			return contents;
		};

		const contents = await getDownloadedContents();

		const result = await parseCsv(contents);

		return csvToJson(result);
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
		makeSnapshot,
	};
};

(async () => {
	const {
		loginWithIdentifier,
		downloadTransactions,
		enterAccessCode,
		endSession,
		waitForPageChange,
		getAccounts,
		getTransactions,
		makeSnapshot,
	} = await triodosLogin();

	let loggedIn = false;

	console.log('Fetching budgets..');
	const budgets = await ynab('/budgets');

	for (const budget of budgets) {
		console.log(`Fetching accounts for ${budget.name}..`);

		const accounts = await ynab(`/budgets/${budget.id}/accounts`);

		for (const account of accounts) {
			if (
				!account.note ||
				!account.note.includes('TRIO') ||
				!IBAN.isValid(account.note)
			) {
				// console.log(`Skipping ${account.name}, has no Triodos IBAN linked`);
				continue;
			}

			const formattedIban = IBAN.electronicFormat(account.note);
			const jsonFilePath = path.resolve(
				__dirname,
				'tmp',
				`${formattedIban}.json`
			);

			console.log(
				`Fetching transactions for ${account.name} from ${formattedIban}..`
			);

			if (!loggedIn) {
				await loginWithIdentifier(IDENTIFIER_ID);
				await waitForPageChange();
				// await makeSnapshot();

				console.log('Not logged in yet!');
				const accessCode = await ask('Access code identifier: ');
				// await makeSnapshot();

				const loginWithAccessCode = await enterAccessCode(accessCode);
				// await makeSnapshot();

				await loginWithAccessCode();
				// console.log('login...');
				await waitForPageChange();
				// console.log('waiting...');
				// await makeSnapshot();
				loggedIn = true;
			}

			const transactions = await downloadTransactions(formattedIban);
			await writeFile(jsonFilePath, JSON.stringify(transactions, null, 2));
		}
	}

	await endSession();
})();
