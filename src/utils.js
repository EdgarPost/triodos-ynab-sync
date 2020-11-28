import IBAN from 'iban';

const toMoney = x => {
  if (!x) {
    return null;
  }
  return Math.abs(Number(x.replace(/[^0-9]/g, ''))) * 10;
};

const toDate = date => {
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
