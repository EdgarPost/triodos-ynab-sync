"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeConfig = exports.readConfig = exports.createLastImportDate = exports.triodosToJSON = exports.toDate = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const util_1 = require("util");
const iban_1 = __importDefault(require("iban"));
const index_js_1 = __importDefault(require("date-fns/format/index.js"));
const index_js_2 = __importDefault(require("date-fns/sub/index.js"));
const readFile = util_1.promisify(fs_1.default.readFile);
const writeFile = util_1.promisify(fs_1.default.writeFile);
const toMoney = (x) => {
    if (!x) {
        return 0;
    }
    return Math.abs(Number(x.replace(/[^0-9]/g, ''))) * 10;
};
const toDate = (date) => {
    const [d, m, y] = date.split('-');
    return new Date([y, m, d].join('-'));
};
exports.toDate = toDate;
const triodosToJSON = (transaction) => {
    const type = transaction['Bedrag bij'] ? 'inflow' : 'outflow';
    const date = exports.toDate(transaction.Transactiedatum);
    const description = transaction.Omschrijving.split('\\')[0]
        .trim()
        .substring(0, 100);
    const payee = transaction.Naam || description;
    const amount = toMoney(transaction['Bedrag bij'] || transaction['Bedrag af']);
    const iban = iban_1.default.isValid(transaction.Tegenrekening)
        ? iban_1.default.printFormat(transaction.Tegenrekening)
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
exports.triodosToJSON = triodosToJSON;
const createLastImportDate = (date = new Date(), days = 3) => {
    return index_js_1.default(index_js_2.default(date, {
        days,
    }), 'yyyy-MM-dd');
};
exports.createLastImportDate = createLastImportDate;
const configFilename = path_1.default.resolve(process.cwd(), '.sync-config');
const defaultConfig = {};
const readConfig = async (file = configFilename) => {
    let config;
    try {
        const contents = await readFile(file);
        config = JSON.parse(contents.toString());
    }
    catch (e) {
        config = defaultConfig;
    }
    if (!config.lastImportDate) {
        config.lastImportDate = exports.createLastImportDate(new Date(), 60);
    }
    return {
        ...config,
        lastImportDate: new Date(config.lastImportDate),
    };
};
exports.readConfig = readConfig;
const writeConfig = async (config, file = configFilename) => writeFile(file, JSON.stringify({
    ...config,
    lastImportDate: exports.createLastImportDate().toString(),
}, null, 2));
exports.writeConfig = writeConfig;
