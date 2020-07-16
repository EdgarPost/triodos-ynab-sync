import IBAN from 'iban';
import crypto from 'crypto';

const generateImportId = parts => {
	const shasum = crypto.createHash('sha1');
	shasum.update(parts.join(''));

	return shasum.digest('hex');
};

const toMoney = x => {
	if (!x) {
		return null;
	}
	return Math.abs(Number(x.replace(/[^0-9]/g, ''))) * 10;
};

const formatString = x => {
	if (!x) {
		return null;
	}
	return x.trim();
};

const toDate = date => {
	const [d, m, y] = date.split('-');
	return new Date([y, m, d].join('-'));
};

const csvToJson = csv =>
	csv.map(
		([date, toIban, amount, type, fromName, fromIban, code, description]) => {
			return {
				id: generateImportId([
					date,
					amount,
					fromName,
					type,
					code,
					fromIban,
					description,
				]),
				date: toDate(date),
				amount: toMoney(amount),
				type: type === 'Credit' ? 'inflow' : 'outflow',
				payee: fromName ? fromName : description.split('\\')[0].trim(),
				iban: fromIban ? IBAN.printFormat(fromIban) : null,
				description: description || null,
			};
		}
	);

export default csvToJson;
